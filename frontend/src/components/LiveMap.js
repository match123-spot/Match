'use client';

import { MapContainer, TileLayer, CircleMarker, Popup, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const AU_NZ_CENTER = [-32, 155];

function fmtWindow(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString()} ${s.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${e.toLocaleTimeString(
    [],
    { hour: '2-digit', minute: '2-digit' }
  )}`;
}

export function CarrierMap({ carriers }) {
  return (
    <MapContainer center={AU_NZ_CENTER} zoom={4} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {carriers.map((c) => (
        <CircleMarker
          key={c.availability_id}
          center={[c.coords.lat, c.coords.lng]}
          radius={9}
          pathOptions={{ color: '#1d4ed8', fillColor: '#3b82f6', fillOpacity: 0.85, weight: 2 }}
        >
          <Popup>
            <div className="text-sm">
              <p className="font-semibold">{c.company_name}</p>
              <p>
                {c.truck_type} · {c.truck_capacity_kg}kg
              </p>
              <p className="text-gray-500">{c.origin_region}</p>
              <p className="text-gray-500">{fmtWindow(c.window_start, c.window_end)}</p>
              <p className="text-gray-500">Acceptance rate: {c.historical_acceptance_rate}%</p>
              {c.rating_count > 0 && (
                <p className="text-gray-500">
                  ★ {Number(c.avg_star).toFixed(1)} ({c.rating_count} rating{c.rating_count === 1 ? '' : 's'})
                </p>
              )}
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

export function ShipmentMap({ shipments }) {
  return (
    <MapContainer center={AU_NZ_CENTER} zoom={4} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {shipments.map((s) => (
        <div key={s.id}>
          <Polyline
            positions={[
              [s.originCoords.lat, s.originCoords.lng],
              [s.destinationCoords.lat, s.destinationCoords.lng],
            ]}
            pathOptions={{ color: '#16a34a', weight: 2, dashArray: '4 6' }}
          />
          <CircleMarker
            center={[s.originCoords.lat, s.originCoords.lng]}
            radius={8}
            pathOptions={{ color: '#15803d', fillColor: '#22c55e', fillOpacity: 0.85, weight: 2 }}
          >
            <Popup>
              <div className="text-sm">
                <p className="font-semibold">
                  {s.origin_region} → {s.destination_region}
                  {s.distance_km != null && <span className="font-normal text-gray-400"> ({s.distance_km}km)</span>}
                </p>
                <p>
                  {s.weight_kg}kg{s.pallet_count != null ? ` · ${s.pallet_count} pallets` : ''} · {s.truck_type_required}
                </p>
                {s.customer_name && <p className="text-gray-500">Customer: {s.customer_name}</p>}
                {s.contracted_rate != null && (
                  <p className="text-gray-500">
                    Contracted rate ({s.current_lsp ?? 'current LSP'}): ${Number(s.contracted_rate).toFixed(2)}
                  </p>
                )}
                {s.ai_recommended_rate != null && (
                  <p className="font-medium text-green-700">AI marketplace rate: ${Number(s.ai_recommended_rate).toFixed(2)} AUD</p>
                )}
                {s.ai_rate_reasoning && <p className="mt-1 text-xs italic text-gray-500">{s.ai_rate_reasoning}</p>}
                <p className="text-gray-500">Loading: {fmtWindow(s.pickup_window_start, s.pickup_window_end)}</p>
                {s.expected_delivery_start && (
                  <p className="text-gray-500">Delivery: {fmtWindow(s.expected_delivery_start, s.expected_delivery_end)}</p>
                )}
              </div>
            </Popup>
          </CircleMarker>
          <CircleMarker
            center={[s.destinationCoords.lat, s.destinationCoords.lng]}
            radius={6}
            pathOptions={{ color: '#b91c1c', fillColor: '#ef4444', fillOpacity: 0.85, weight: 2 }}
          >
            <Popup>
              <div className="text-sm">
                <p className="font-semibold">Destination: {s.destination_region}</p>
              </div>
            </Popup>
          </CircleMarker>
        </div>
      ))}
    </MapContainer>
  );
}
