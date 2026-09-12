const assert = require('node:assert/strict');
const path = require('node:path');
const { findDeliveryZone, loadDeliveryZones } = require('../lib/delivery-zones');

const zones = loadDeliveryZones(path.join(__dirname, '..', 'data', 'delivery-zones.geojson'));

assert.deepEqual(findDeliveryZone(zones, 38.21121551653255, 55.572140786212834), {
  name: 'Зона 1', code: 'zone1', fee: 100,
});
assert.deepEqual(findDeliveryZone(zones, 38.150, 55.610), {
  name: 'Зона 2', code: 'zone2', fee: 200,
});
assert.equal(findDeliveryZone(zones, 37.6173, 55.7558), null);

console.log('delivery zone tests passed');
