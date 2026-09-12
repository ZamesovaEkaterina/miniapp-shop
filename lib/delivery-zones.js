const fs = require('fs');

const DELIVERY_FEES = {
  'Зона 1': 100,
  'Зона 2': 200,
};

function pointOnSegment(point, a, b, epsilon = 1e-10) {
  const [x, y] = point;
  const [x1, y1] = a;
  const [x2, y2] = b;
  const lengthSquared = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (lengthSquared <= epsilon) return Math.abs(x - x1) <= epsilon && Math.abs(y - y1) <= epsilon;
  const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
  if (Math.abs(cross) > epsilon) return false;
  const dot = (x - x1) * (x2 - x1) + (y - y1) * (y2 - y1);
  if (dot < -epsilon) return false;
  return dot <= lengthSquared + epsilon;
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    if (pointOnSegment(point, a, b)) return true;
    const crosses = ((b[1] > point[1]) !== (a[1] > point[1]))
      && (point[0] < ((a[0] - b[0]) * (point[1] - b[1])) / (a[1] - b[1]) + b[0]);
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, rings) {
  if (!rings.length || !pointInRing(point, rings[0])) return false;
  return !rings.slice(1).some(ring => pointInRing(point, ring));
}

function geometryContainsPoint(geometry, point) {
  if (geometry?.type === 'Polygon') return pointInPolygon(point, geometry.coordinates);
  if (geometry?.type === 'MultiPolygon') {
    return geometry.coordinates.some(polygon => pointInPolygon(point, polygon));
  }
  return false;
}

function loadDeliveryZones(filePath) {
  const geojson = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const zones = (geojson.features || [])
    .filter(feature => DELIVERY_FEES[feature.properties?.description] && ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type))
    .sort((a, b) => a.properties.description.localeCompare(b.properties.description, 'ru'));

  if (!zones.length) throw new Error('В GeoJSON не найдены зоны доставки');
  return zones;
}

function findDeliveryZone(zones, longitude, latitude) {
  const point = [Number(longitude), Number(latitude)];
  if (!point.every(Number.isFinite)) return null;

  for (const feature of zones) {
    if (geometryContainsPoint(feature.geometry, point)) {
      const name = feature.properties.description;
      return { name, code: name === 'Зона 1' ? 'zone1' : 'zone2', fee: DELIVERY_FEES[name] };
    }
  }
  return null;
}

module.exports = {
  DELIVERY_FEES,
  findDeliveryZone,
  geometryContainsPoint,
  loadDeliveryZones,
  pointInRing,
};
