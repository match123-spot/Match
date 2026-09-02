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

/**
 * Claude makes the final call among the top formula-ranked candidates,
 * rather than the formula's #1 winning automatically. The formula still
 * does the heavy lifting — hard eligibility cutoffs (geography, capacity,
 * temperature control) and the weighted score are computed exactly as
 * before, and only the pre-filtered top candidates reach this call at all.
 * This is where judgment the formula can't express gets applied: e.g.
 * preferring a slightly-lower-scoring but much more reliable carrier, or
 * flagging that a right-sized truck's pallet fit deserves a second look
 * before it's the one actually offered.
 *
 * Returns null (formula's #1 stands) if Claude is unavailable, disagrees
 * with itself, or the call fails — this must never block match creation.
 */
async function pickBestCandidate({ shipment, candidates }) {
  if (candidates.length <= 1) return null; // nothing to decide between

  try {
    const candidateList = candidates
      .map((c, i) => {
        const rightSizing =
          c.truckType?.match === 'downsize'
            ? ` [right-sized: smaller ${c.truckType.offered} than the requested ${c.truckType.required}, est. rate $${c.truckType.estimatedRate}]`
            : c.truckType?.match === 'upsize'
              ? ` [larger ${c.truckType.offered} than requested, likely a premium]`
              : '';
        return `${i}. ${c.carrier.companyName} — ${c.availability.truckType} out of ${c.availability.originRegion} (${c.availability.distanceKm ?? '?'}km away). Formula score ${c.scores.total}/100 (distance ${c.scores.distance}, timing ${c.scores.timing}, utilization ${c.scores.utilization}, reliability ${c.scores.reliability}, acceptance rate ${c.scores.acceptanceRate}). Carrier rating: ${c.carrier.avgRating != null ? `${c.carrier.avgRating}/5 (${c.carrier.ratingCount} ratings)` : 'no ratings yet'}.${rightSizing}`;
      })
      .join('\n');

    const msg = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 300,
      tools: [
        {
          name: 'pick_best_candidate',
          description: 'Select the single best carrier candidate to actually offer this shipment to.',
          input_schema: {
            type: 'object',
            properties: {
              selectedIndex: { type: 'integer', description: 'Index of the chosen candidate from the numbered list' },
              reasoning: {
                type: 'string',
                description: 'One or two plain-language sentences on why this candidate over the others',
              },
            },
            required: ['selectedIndex', 'reasoning'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'pick_best_candidate' },
      messages: [
        {
          role: 'user',
          content: `A weighted formula (distance 30%, timing 25%, utilization 15%, reliability 20%, acceptance rate 10%) has already narrowed this shipment down to its top eligible carrier candidates, ranked highest score first. Make the final call on which one to actually offer the shipment to.

Shipment: ${shipment.origin_region} -> ${shipment.destination_region}, ${shipment.weight_kg}kg${shipment.pallet_count ? ` / ${shipment.pallet_count} pallets` : ''}, requires ${shipment.truck_type_required}.

Candidates (index 0 is the formula's top pick):
${candidateList}

The formula score is a strong signal — don't second-guess it without a real reason. Deviate from the top-ranked candidate only when something in the data justifies it (e.g. meaningfully better carrier reliability, a right-sizing opportunity worth the tradeoff, a physical-fit concern). If nothing stands out, pick index 0 and say so.`,
        },
      ],
    });
    const toolUse = msg.content?.find((b) => b.type === 'tool_use');
    const selectedIndex = toolUse?.input?.selectedIndex;
    if (selectedIndex == null || selectedIndex < 0 || selectedIndex >= candidates.length) return null;
    return { selectedIndex, reasoning: toolUse.input.reasoning ?? null };
  } catch (err) {
    console.error('Claude candidate selection failed:', err.message);
    return null;
  }
}

module.exports = { explainMatch, recommendPrice, pickBestCandidate };
