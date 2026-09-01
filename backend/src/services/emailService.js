const sgMail = require('@sendgrid/mail');

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

async function send(msg) {
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
    console.warn('SendGrid not configured (SENDGRID_API_KEY / SENDGRID_FROM_EMAIL) — skipping email:', msg.subject);
    return;
  }
  try {
    await sgMail.send({ ...msg, from: process.env.SENDGRID_FROM_EMAIL });
  } catch (err) {
    const detail = err.response?.body?.errors?.map((e) => e.message).join('; ') ?? err.message;
    console.error('SendGrid send failed:', detail);
  }
}

function money(n) {
  return n == null ? 'TBC' : `$${Number(n).toFixed(2)} AUD`;
}

async function sendMatchRequestEmail(carrierEmails, { shipment }) {
  await send({
    to: carrierEmails,
    subject: `New shipment match: ${shipment.origin_region} → ${shipment.destination_region}`,
    text: `A new shipment has been matched to your available truck.

Route: ${shipment.origin_region} -> ${shipment.destination_region}${shipment.distance_km ? ` (${shipment.distance_km}km)` : ''}
Weight: ${shipment.weight_kg}kg${shipment.pallet_count ? ` · ${shipment.pallet_count} pallets` : ''}
Truck type: ${shipment.truck_type_required}
Marketplace rate: ${money(shipment.ai_recommended_rate)}
Pickup window: ${shipment.pickup_window_start} to ${shipment.pickup_window_end}

You have 20 minutes to approve or reject this match in FreightCopilot before it's offered to another carrier.`,
  });
}

async function sendBookingConfirmationEmail({ shipperEmails, carrierEmails, shipment, carrierCompanyName }) {
  const subject = `Booking confirmed: ${shipment.origin_region} → ${shipment.destination_region}`;
  const savingsLine =
    shipment.contracted_rate != null && shipment.ai_recommended_rate != null
      ? `\nSaved vs contracted rate: ${money(shipment.contracted_rate - shipment.ai_recommended_rate)}`
      : '';
  const body = `Your shipment has been booked.

Route: ${shipment.origin_region} -> ${shipment.destination_region}${shipment.distance_km ? ` (${shipment.distance_km}km)` : ''}
Weight: ${shipment.weight_kg}kg${shipment.pallet_count ? ` · ${shipment.pallet_count} pallets` : ''}
Truck type: ${shipment.truck_type_required}
Marketplace rate: ${money(shipment.ai_recommended_rate)}${savingsLine}
Carrier: ${carrierCompanyName}
Pickup window: ${shipment.pickup_window_start} to ${shipment.pickup_window_end}`;

  await Promise.all([
    send({ to: shipperEmails, subject, text: body }),
    send({ to: carrierEmails, subject, text: body }),
  ]);
}

module.exports = { sendMatchRequestEmail, sendBookingConfirmationEmail };
