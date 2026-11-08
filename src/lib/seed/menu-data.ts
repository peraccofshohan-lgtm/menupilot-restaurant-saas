/**
 * MATI Kitchen demo menu — 50 dishes across 7 categories.
 *
 * `image` maps to an original photograph stored in `public/seed-images`. The seed
 * script uploads each file through the storage service, so no record ever points
 * at a remote hotlink or a broken placeholder.
 */

export interface SeedCategory {
  key: string;
  name: string;
  description: string;
  image: string;
  items: SeedItem[];
}

export interface SeedItem {
  name: string;
  description: string;
  price: number;
  featured?: boolean;
  unavailable?: boolean;
  prep?: number;
}

export const DEMO_RESTAURANT = {
  name: "MATI Kitchen",
  slug: "mati-kitchen",
  tagline: "Slow-cooked Bengali comfort, served fast.",
  description:
    "MATI Kitchen is a contemporary Bengali kitchen in Dhanmondi. Our kacchi is still sealed in clay pots, our bhuna simmers for four hours, and everything is prepared to order. Scan, order, and we will bring it to your table.",
  phone: "+880 1700 000000",
  email: "hello@matikitchen.demo",
  address: "House 42, Road 27, Dhanmondi",
  city: "Dhaka",
  currency: "BDT",
  timeZone: "Asia/Dhaka",
  taxLabel: "VAT",
  taxRate: 5,
  serviceChargeLabel: "Service charge",
  serviceChargeRate: 5,
  orderPrefix: "MATI",
} as const;

export const DEMO_MENU: SeedCategory[] = [
  {
    key: "starters",
    name: "Starters",
    description: "Small plates built for sharing.",
    image: "starters",
    items: [
      { name: "Chicken Shashlik Skewers", price: 420, prep: 15, featured: true, description: "Charred chicken thigh, bell pepper and onion on skewers, brushed with a smoky chilli glaze. Served with mint chutney." },
      { name: "Peri Peri Chicken Wings", price: 380, prep: 18, description: "Six wings marinated overnight in bird's eye chilli, lime and garlic, then grilled until the skin crackles." },
      { name: "Crispy Chilli Squid", price: 620, prep: 16, description: "Bay squid tossed in cornflour, flash fried and folded through a sweet-hot chilli sauce with spring onion." },
      { name: "Paneer Tikka Bites", price: 350, prep: 14, description: "Hand-pressed paneer cubes in yoghurt and kasundi mustard marinade, finished on the grill." },
      { name: "Beef Seekh Kebab", price: 480, prep: 20, description: "Minced beef with roasted cumin, green chilli and coriander, moulded on skewers over open flame." },
      { name: "Crispy Onion Rings", price: 260, prep: 10, description: "Buttermilk-brined onion rings in a light beer batter, with smoked paprika mayo." },
      { name: "Vegetable Samosa Platter", price: 220, prep: 12, description: "Four flaky samosas filled with spiced potato and green peas, served with tamarind and mint chutney." },
    ],
  },
  {
    key: "main-course",
    name: "Main Course",
    description: "Slow-cooked curries and the dishes we are known for.",
    image: "curry",
    items: [
      { name: "Beef Bhuna", price: 620, prep: 25, featured: true, description: "Beef shin simmered four hours in a dry masala of roasted whole spices until the gravy clings to every piece." },
      { name: "Chicken Korma", price: 520, prep: 22, description: "Country chicken in a pale almond and poppy seed korma, finished with kewra water and fried onion." },
      { name: "Mutton Rogan Josh", price: 780, prep: 30, featured: true, description: "Kashmiri-style mutton with Kashmiri chilli, fennel and yoghurt. Deep red, gently tart, unforgivingly rich." },
      { name: "Butter Chicken", price: 560, prep: 20, description: "Tandoor-charred chicken folded into a tomato and cashew gravy with a generous knob of white butter." },
      { name: "Prawn Malai Curry", price: 720, prep: 22, description: "Tiger prawns poached in thick coconut milk with green chilli and a whisper of mustard oil." },
      { name: "Chicken Tikka Masala", price: 540, prep: 20, description: "Yoghurt-marinated tikka in a roasted tomato masala, mildly sweet with a slow heat at the back." },
      { name: "Dal Makhani", price: 320, prep: 18, description: "Black urad dal simmered overnight with tomato, butter and cream. Vegetarian and unapologetically heavy." },
      { name: "Aloo Gobi Masala", price: 300, prep: 16, description: "Potato and cauliflower dry-fried with turmeric, ginger and cumin seeds. Simple and clean." },
    ],
  },
  {
    key: "rice-biryani",
    name: "Rice & Biryani",
    description: "Aromatic rice, sealed and steamed.",
    image: "biryani",
    items: [
      { name: "Mutton Kacchi Biryani", price: 680, prep: 35, featured: true, description: "Our signature: marinated mutton and aged basmati layered in a clay pot, sealed with dough and cooked on dum." },
      { name: "Chicken Hyderabadi Biryani", price: 520, prep: 30, description: "Marinated chicken thigh with saffron rice, fried onion and a boiled egg on the side." },
      { name: "Beef Tehari", price: 460, prep: 25, description: "Dhaka-style beef tehari with short-grain rice, mustard oil and green chilli. Street food done properly." },
      { name: "Prawn Pulao", price: 640, prep: 25, description: "Prawns and long-grain rice cooked together in coconut stock with curry leaf and lime." },
      { name: "Steamed Basmati Rice", price: 120, prep: 8, description: "Aged basmati, steamed with a cardamom pod. One generous portion." },
      { name: "Vegetable Fried Rice", price: 280, prep: 12, description: "Wok-tossed rice with seasonal vegetables, egg and light soy." },
      { name: "Lemon Rice", price: 220, prep: 10, description: "South Indian lemon rice with peanuts, curry leaf and mustard seed. Bright and light." },
    ],
  },
  {
    key: "burgers-sandwiches",
    name: "Burgers & Sandwiches",
    description: "Griddled, stacked and served with fries.",
    image: "burger",
    items: [
      { name: "MATI Signature Beef Burger", price: 520, prep: 18, featured: true, description: "180g aged beef patty, smoked cheddar, caramelised onion, house pickles and burger sauce in a brioche bun." },
      { name: "Grilled Chicken Club Sandwich", price: 420, prep: 15, description: "Triple-decker with grilled chicken, cheese, bacon-style beef strips, tomato and lettuce. Served with fries." },
      { name: "Smoky Paneer Burger", price: 380, prep: 15, description: "Thick-cut paneer in tandoori marinade with mint mayo, pickled onion and spinach." },
      { name: "Crispy Fish Burger", price: 440, prep: 18, description: "Bhetki fillet in a crisp batter with tartar sauce, shredded cabbage and lemon." },
      { name: "Beef Cheeseburger", price: 480, prep: 15, description: "The straightforward one: beef patty, double cheese, ketchup, mustard, onion." },
      { name: "Chicken Shawarma Wrap", price: 320, prep: 12, description: "Rotisserie chicken, garlic toum, pickles and fries wrapped in warm khubz." },
      { name: "Tuna Melt Sandwich", price: 400, prep: 12, description: "Tuna bound with mayo and spring onion, cheddar melted over the top on sourdough." },
    ],
  },
  {
    key: "pizza-pasta",
    name: "Pizza & Pasta",
    description: "Wood-fired pizza and pasta cooked to order.",
    image: "pizza",
    items: [
      { name: "Margherita Pizza", price: 620, prep: 20, description: "11 inch, 48-hour cold-fermented dough, San Marzano tomato, fior di latte, basil, olive oil." },
      { name: "Chicken Tikka Pizza", price: 780, prep: 22, description: "Tikka chicken, red onion, green chilli and coriander over mozzarella and a spiced tomato base." },
      { name: "Beef Pepperoni Pizza", price: 820, prep: 22, description: "Spicy beef pepperoni, mozzarella, oregano and hot honey drizzle." },
      { name: "Creamy Chicken Alfredo", price: 540, prep: 18, description: "Fettuccine in a parmesan cream with grilled chicken, cracked pepper and parsley." },
      { name: "Penne Arrabbiata", price: 420, prep: 16, description: "Penne in a slow-cooked tomato sauce with garlic, chilli and basil. Vegetarian." },
      { name: "Beef Lasagna", price: 620, prep: 25, description: "Layered pasta with slow-cooked beef ragu, bechamel and a gratinated cheese top." },
      { name: "Spaghetti Aglio e Olio", price: 380, prep: 14, description: "Garlic, olive oil, chilli flakes and parsley. Four ingredients, no shortcuts." },
    ],
  },
  {
    key: "drinks",
    name: "Drinks",
    description: "Cold, hot and everything in between.",
    image: "drinks",
    items: [
      { name: "Classic Mango Lassi", price: 180, prep: 5, featured: true, description: "Alphonso mango pulp churned with thick yoghurt and a pinch of cardamom." },
      { name: "Fresh Lemonade", price: 140, prep: 4, description: "Hand-squeezed lemon, cane sugar and soda over crushed ice." },
      { name: "Masala Cha", price: 90, prep: 6, description: "Strong milk tea with cardamom, clove and ginger. The way it should be." },
      { name: "Iced Filter Coffee", price: 160, prep: 6, description: "Chicory blend decoction over milk and ice, lightly sweetened." },
      { name: "Cold Brew Coffee", price: 220, prep: 3, description: "Eighteen-hour cold extraction, served black over ice." },
      { name: "Sparkling Mint Cooler", price: 190, prep: 5, description: "Mint, lime and cucumber muddled with soda. Non-alcoholic and very cold." },
      { name: "Bottled Water", price: 40, prep: 1, description: "500 ml sealed mineral water." },
    ],
  },
  {
    key: "desserts",
    name: "Desserts",
    description: "Order early, they run out.",
    image: "dessert",
    items: [
      { name: "Chocolate Lava Cake", price: 320, prep: 12, featured: true, description: "Dark chocolate 70% cake with a molten centre, vanilla bean ice cream and pistachio crumb." },
      { name: "Mango Cheesecake", price: 340, prep: 5, description: "Baked cheesecake with a mango compote top on a butter biscuit base." },
      { name: "Caramel Custard", price: 220, prep: 5, description: "Silky set custard with a bitter caramel base. Chilled." },
      { name: "Gulab Jamun (2 pcs)", price: 150, prep: 4, description: "Warm milk dumplings soaked in rose and cardamom syrup." },
      { name: "Vanilla Bean Ice Cream", price: 180, prep: 3, description: "Two scoops of Madagascar vanilla bean ice cream." },
      { name: "Pistachio Kulfi", price: 200, prep: 3, description: "Slow-reduced milk with pistachio and saffron, frozen on sticks." },
      { name: "Tres Leches Slice", price: 300, prep: 5, description: "Sponge soaked in three milks, topped with lightly whipped cream and cinnamon." },
    ],
  },
];

export const DEMO_TABLE_COUNT = 20;
