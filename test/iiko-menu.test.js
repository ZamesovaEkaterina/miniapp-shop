const assert = require('assert');
const { mapExternalMenu } = require('../lib/iiko-menu');

const menu = {
  itemCategories: [{
    id: 7,
    name: 'Бургеры',
    items: [
      { itemId: 'burger', name: 'Классик', itemSizes: [{ isDefault: true, sizeId: 'default', prices: [{ organizationId: 'org', price: 350 }] }] },
      { itemId: 'no-price', name: 'Без цены', itemSizes: [{ prices: [{ organizationId: 'org', price: null }] }] },
      { itemId: 'stopped', name: 'Стоп', itemSizes: [{ prices: [{ organizationId: 'org', price: 100 }] }] },
    ],
  }],
};

const result = mapExternalMenu(menu, { organizationId: 'org', stoppedProductIds: new Set(['stopped']) });
assert.deepStrictEqual(result.categories, [{ id: '7', name: 'Бургеры' }]);
assert.deepStrictEqual(result.products, [{
  id: 'burger', sizeId: 'default', name: 'Классик', description: '', imageUrl: null,
  price: 350, categoryId: '7', categoryName: 'Бургеры',
}]);
console.log('iiko external menu mapping tests passed');
