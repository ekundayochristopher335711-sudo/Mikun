export const seedMenu = [
  { id: 'dish-1', name: 'Semo with beef', category: 'Dishes', price: 1500, description: '', available: true },
  { id: 'dish-2', name: 'Eba with beef', category: 'Dishes', price: 1500, description: '', available: true },
  { id: 'dish-3', name: 'Small plate of jollof & fried rice with beef', category: 'Dishes', price: 1700, description: '', available: true },
  { id: 'dish-4', name: 'Spag with beef', category: 'Dishes', price: 1700, description: '', available: true },
  { id: 'dish-5', name: 'Pounded yam per plate (per one 500)', category: 'Dishes', price: 1700, description: '', available: true },
  { id: 'dish-6', name: 'Small plate of asun jollof with beef', category: 'Dishes', price: 1900, description: '', available: true },
  { id: 'dish-7', name: 'Rice and beans small plate with beef', category: 'Dishes', price: 1900, description: '', available: true },
  { id: 'dish-8', name: 'Village rice with beef small plate', category: 'Dishes', price: 1900, description: '', available: true },
  { id: 'dish-9', name: 'Big plate of jollof & fried rice with beef', category: 'Dishes', price: 2200, description: '', available: true },
  { id: 'dish-10', name: 'Big plate of asun jollof with beef', category: 'Dishes', price: 2600, description: '', available: true },
  { id: 'dish-11', name: 'Rice and beans with beef big plate', category: 'Dishes', price: 2500, description: '', available: true },
  { id: 'dish-12', name: 'Village rice with beef big plate', category: 'Dishes', price: 2600, description: '', available: true },
  { id: 'dish-13', name: 'Yam and egg', category: 'Dishes', price: 3000, description: '', available: true },
  { id: 'protein-1', name: 'Small chicken', category: 'Proteins', price: 2000, description: '', available: true },
  { id: 'protein-2', name: 'Big chicken', category: 'Proteins', price: 2500, description: '', available: true },
  { id: 'protein-3', name: 'Turkey', category: 'Proteins', price: 3000, description: '', available: true },
  { id: 'protein-4', name: 'Fish', category: 'Proteins', price: 1500, description: '', available: true },
  { id: 'protein-5', name: 'Egg', category: 'Proteins', price: 300, description: '', available: true },
  { id: 'drink-1', name: 'Table water', category: 'Drinks', price: 250, description: '', available: true },
  { id: 'drink-2', name: 'Big Coke', category: 'Drinks', price: 500, description: '', available: true },
  { id: 'drink-3', name: 'Big Fanta', category: 'Drinks', price: 500, description: '', available: true },
  { id: 'drink-4', name: 'Big Sprite', category: 'Drinks', price: 500, description: '', available: true },
];

export const seedSettings = {
  businessName: 'MIKUN',
  tagline: 'Good food. Good vibe.',
  phone: '',
  address: '',
  hours: '',
  instagram: '',
  currency: '₦',
  acceptingOrders: true,
};

export const categories = ['Dishes', 'Proteins', 'Drinks'];

export function formatPrice(price, currency = '₦') {
  return `${currency}${Number(price || 0).toLocaleString('en-NG')}`;
}
