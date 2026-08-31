const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
    ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID }
    : undefined,
});

async function explainMatch({ shipment, carrier, availability, scores }) {
  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `You are helping a freight dispatcher understand a proposed carrier match. Explain in 2-3 concise, plain-language sentences why this is (or isn't) a strong match. Write the explanation directly, no preamble.

Shipment: ${shipment.origin_region} -> ${shipment.destination_region}, ${shipment.weight_kg}kg, requires ${shipment.truck_type_required}, pickup window ${shipment.pickup_window_start} to ${shipment.pickup_window_end}.
Carrier: ${carrier.companyName}, based in ${carrier.baseLocation}, historical acceptance rate ${carrier.historicalAcceptanceRate}%. Offering a ${availability.truckType} (capacity ${availability.truckCapacityKg}kg) out of ${availability.originRegion}, available ${availability.windowStart} to ${availability.windowEnd}.
Scores (0-100 each): overall ${scores.total}, distance fit ${scores.distance}, timing overlap ${scores.timing}, truck utilization ${scores.utilization}, reliability ${scores.reliability}, acceptance rate ${scores.acceptanceRate}.`,
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

module.exports = { explainMatch };
