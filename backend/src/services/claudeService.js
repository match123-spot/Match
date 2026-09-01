const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
    ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID }
    : undefined,
});

async function explainMatch({ shipment, carrier, availability, scores, truckType }) {
  try {
    const truckTypeNote =
      truckType?.match === 'downsize'
        ? `\nNote: the shipment was specified as requiring a ${truckType.required}, but this carrier's ${truckType.offered} has enough capacity for the actual load — flag this as a right-sizing opportunity (likely a cheaper truck class) in your explanation.`
        : truckType?.match === 'upsize'
          ? `\nNote: this carrier's ${truckType.offered} is a larger class than the ${truckType.required} the shipment specified — mention that it's a valid but likely more expensive fallback.`
          : '';

    const msg = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 220,
      messages: [
        {
          role: 'user',
          content: `You are helping a freight dispatcher understand a proposed carrier match. Explain in 2-3 concise, plain-language sentences why this is (or isn't) a strong match. Write the explanation directly, no preamble.

Shipment: ${shipment.origin_region} -> ${shipment.destination_region}, ${shipment.weight_kg}kg${shipment.pallet_count ? ` / ${shipment.pallet_count} pallets` : ''}, requires ${shipment.truck_type_required}, pickup window ${shipment.pickup_window_start} to ${shipment.pickup_window_end}.
Carrier: ${carrier.companyName}, based in ${carrier.baseLocation}, historical acceptance rate ${carrier.historicalAcceptanceRate}%. Offering a ${availability.truckType} (capacity ${availability.truckCapacityKg}kg) out of ${availability.originRegion}, available ${availability.windowStart} to ${availability.windowEnd}.
Scores (0-100 each): overall ${scores.total}, distance fit ${scores.distance}, timing overlap ${scores.timing}, truck utilization ${scores.utilization}, reliability ${scores.reliability}, acceptance rate ${scores.acceptanceRate}.${truckTypeNote}`,
        },
      ],
    });
    const block = msg.content?.find((b) => b.type === 'text');
    return block?.text?.trim() ?? null;
  } catch (err) {
    console.error('Claude explanation failed:', err.message);
    return null;
  }
}

async function recommendPrice({ originRegion, destinationRegion, weightKg, truckType, distanceKm, marketEstimate }) {
  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 300,
      tools: [
        {
          name: 'recommend_price',
          description: 'Recommend an AUD freight rate for this shipment.',
          input_schema: {
            type: 'object',
            properties: {
              rate: { type: 'number', description: 'Recommended total linehaul rate in AUD' },
              reasoning: { type: 'string', description: 'One or two plain-language sentences explaining the rate' },
            },
            required: ['rate', 'reasoning'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'recommend_price' },
      messages: [
        {
          role: 'user',
          content: `Recommend a fair AUD linehaul rate for this AU/NZ freight shipment.

Origin: ${originRegion}
Destination: ${destinationRegion}
Approximate distance: ${Math.round(distanceKm)}km
Weight: ${weightKg}kg
Truck type required: ${truckType} (refrigerated and B-double typically command a premium over rigid/semi)
A simple distance+weight formula estimates: $${marketEstimate} AUD (anchor only, not authoritative)

Consider distance, weight, and truck type premium against typical AU/NZ domestic linehaul market rates. Return a realistic rate — it can differ from the formula estimate if you have good reason, but stay in a plausible range for this lane.`,
        },
      ],
    });
    const toolUse = msg.content?.find((b) => b.type === 'tool_use');
    if (!toolUse?.input?.rate) return null;
    return {
      rate: Math.round(toolUse.input.rate * 100) / 100,
      reasoning: toolUse.input.reasoning ?? null,
    };
  } catch (err) {
    console.error('Claude price recommendation failed:', err.message);
    return null;
  }
}

module.exports = { explainMatch, recommendPrice };
