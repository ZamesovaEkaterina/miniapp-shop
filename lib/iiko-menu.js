function selectSizeWithPrice(item, organizationId) {
  const sizes = Array.isArray(item?.itemSizes) ? item.itemSizes : [];
  const ordered = [
    ...sizes.filter(size => size?.isDefault),
    ...sizes.filter(size => !size?.isDefault),
  ];

  for (const size of ordered) {
    const prices = Array.isArray(size?.prices) ? size.prices : [];
    const price = prices.find(value => value?.organizationId === organizationId)?.price
      ?? prices.find(value => Number.isFinite(value?.price))?.price;
    if (Number.isFinite(price) && price > 0) return { size, price };
  }
  return null;
}

function mapExternalMenu(menu, { organizationId, stoppedProductIds = new Set() } = {}) {
  const categories = [];
  const products = [];

  for (const category of menu?.itemCategories || []) {
    const categoryId = String(category?.id ?? `category-${categories.length + 1}`);
    const categoryName = String(category?.name || 'Без категории');
    const categoryProducts = [];

    for (const item of category?.items || []) {
      if (!item?.itemId || stoppedProductIds.has(item.itemId)) continue;
      const selected = selectSizeWithPrice(item, organizationId);
      if (!selected) continue;

      categoryProducts.push({
        id: item.itemId,
        sizeId: selected.size?.sizeId || null,
        name: String(item.name || 'Без названия'),
        description: String(item.description || ''),
        imageUrl: selected.size?.buttonImageUrl || item.buttonImageUrl || null,
        price: Math.round(selected.price * 100) / 100,
        categoryId,
        categoryName,
      });
    }

    if (categoryProducts.length) {
      categories.push({ id: categoryId, name: categoryName });
      products.push(...categoryProducts);
    }
  }

  return { categories, products };
}

module.exports = { mapExternalMenu, selectSizeWithPrice };
