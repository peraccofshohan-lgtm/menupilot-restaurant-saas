/**
 * Bengali names and descriptions for the MATI Kitchen demo menu.
 *
 * Kept apart from `menu-data.ts` on purpose:
 *
 *   * The English file is the canonical catalogue — prices, photos, prep times
 *     and availability stay there, so a demo reset cannot lose them.
 *   * This file is a pure lookup by English name. Adding a dish without a
 *     Bengali entry is not fatal: the guest sees the English name, which is
 *     exactly what happened before this file existed.
 *
 * Name choices are what the dish is actually called in a Dhaka restaurant, not
 * a literal translation. "Beef Bhuna" stays "বিফ ভুনা" because that is what a
 * guest says out loud; "Crispy Onion Rings" becomes "মুচমুচে পেঁয়াজ Rings"
 * rather than an invented compound nobody would read.
 */
export interface BanglaContent {
  name: string;
  description: string;
}

export const BANGLA_CATEGORIES: Record<string, BanglaContent> = {
  Starters: {
    name: "শুরুতে",
    description: "ভাগ করে খাওয়ার জন্য ছোট প্লেট।",
  },
  "Main Course": {
    name: "প্রধান খাবার",
    description: "ভাত ও রুটির সঙ্গে পরিবেশিত প্রধান পদ।",
  },
  "Rice & Biryani": {
    name: "ভাত ও বিরিয়ানি",
    description: "মাটির হাঁড়িতে রাঁধা সুগন্ধি বিরিয়ানি ও পোলাও।",
  },
  "Burgers & Sandwiches": {
    name: "বার্গার ও স্যান্ডউইচ",
    description: "হাতে বানানো প্যাটি, তাজা রুটি।",
  },
  "Pizza & Pasta": {
    name: "পিৎজা ও পাস্তা",
    description: "পাথরের চুলায় বেক করা পিৎজা, তাজা পাস্তা।",
  },
  Drinks: {
    name: "পানীয়",
    description: "ঠান্ডা ও গরম — দুই-ই আছে।",
  },
  Desserts: {
    name: "মিষ্টান্ন",
    description: "খাবারের শেষে মিষ্টি কিছু।",
  },
};

export const BANGLA_MENU: Record<string, BanglaContent> = {
  // ------------------------------------------------------------------ starters
  "Chicken Shashlik Skewers": {
    name: "চিকেন শাশলিক",
    description: "কয়লায় পোড়া মুরগির মাংস, ক্যাপসিকাম ও পেঁয়াজ শিকে গাঁথা, ধোঁয়াটে মরিচের গ্লেজ মাখানো। সঙ্গে পুদিনার চাটনি।",
  },
  "Peri Peri Chicken Wings": {
    name: "পেরি পেরি চিকেন উইংস",
    description: "ছয়টি ডানা রাতভর কাঁচা মরিচ, লেবু ও রসুনে মাখানো, তারপর গ্রিল করা — চামড়া মুচমুচে হওয়া পর্যন্ত।",
  },
  "Crispy Chilli Squid": {
    name: "মুচমুচে চিলি স্কুইড",
    description: "কর্নফ্লাওয়ারে মাখিয়ে ভাজা স্কুইড, মিষ্টি-ঝাল মরিচের সসে পেঁয়াজকলির সঙ্গে মেশানো।",
  },
  "Paneer Tikka Bites": {
    name: "পনির টিক্কা",
    description: "দই ও মসলায় মাখানো পনিরের টুকরো, টমেটো ও ক্যাপসিকামের সঙ্গে তন্দুরে সেঁকা।",
  },
  "Beef Seekh Kebab": {
    name: "বিফ সিক কাবাব",
    description: "হাতে মাখা গরুর মাংসের কিমা, ধনে ও জিরার মসলায় শিকে পোড়ানো, পুদিনার চাটনি ও পেঁয়াজের সঙ্গে।",
  },
  "Crispy Onion Rings": {
    name: "মুচমুচে পেঁয়াজ রিং",
    description: "বেসনের আস্তরণে ভাজা মিষ্টি পেঁয়াজের রিং, সঙ্গে চিপোটলে মেয়োনিজ।",
  },
  "Vegetable Samosa Platter": {
    name: "সবজি সিঙ্গারা প্লেটার",
    description: "চারটি সিঙ্গারা — আলু, মটরশুঁটি ও গাজরে ভরা, তেঁতুল ও পুদিনার চাটনির সঙ্গে।",
  },

  // -------------------------------------------------------------- main course
  "Beef Bhuna": {
    name: "বিফ ভুনা",
    description: "চার ঘণ্টা ধীরে জ্বাল দেওয়া গরুর মাংস, জিরা-ধনে ও কালো এলাচের গভীর মসলায়, আলু ছাড়া।",
  },
  "Chicken Korma": {
    name: "চিকেন কোরমা",
    description: "দই, কাজুবাদাম ও কেওড়ার পানিতে রান্না মুরগি — সাদা, মিহি স্বাদ।",
  },
  "Mutton Rogan Josh": {
    name: "মাটন রগন জোশ",
    description: "কাশ্মীরি মরিচ ও গরম মসলায় আস্তে রাঁধা খাসির মাংস, উপরে তাজা ধনে পাতা।",
  },
  "Butter Chicken": {
    name: "বাটার চিকেন",
    description: "তন্দুরে সেঁকা মুরগি, টমেটো ও মাখনের মসৃণ গ্রেভিতে, এক ফোঁটা ক্রিম দিয়ে।",
  },
  "Prawn Malai Curry": {
    name: "চিংড়ি মালাইকারি",
    description: "বড় চিংড়ি, নারকেল দুধ ও সরিষার তেলের হালকা মসলায় রান্না।",
  },
  "Chicken Tikka Masala": {
    name: "চিকেন টিক্কা মসলা",
    description: "টমেটো-ভিত্তিক মসলাদার গ্রেভিতে ভাজা টিক্কা, ধোঁয়াটে স্বাদ সহ।",
  },
  "Dal Makhani": {
    name: "দাল মাখানি",
    description: "কালো ডাল রাতভর কম আঁচে রান্না, মাখন ও ক্রিমে শেষ করা।",
  },
  "Aloo Gobi Masala": {
    name: "আলু গোবি",
    description: "শুকনো মসলায় ভাজা আলু ও ফুলকপি, রান্নার সবচেয়ে সহজ অথচ সেরা স্বাদ।",
  },

  // ----------------------------------------------------------- rice & biryani
  "Mutton Kacchi Biryani": {
    name: "মাটন কাচ্চি বিরিয়ানি",
    description: "মাটির হাঁড়িতে সিল করা খাসির কাচ্চি — রান্নার আগে কাঁচা মাংস, আলু ও ঘি-মাখা চাল একসঙ্গে স্তরে সাজানো।",
  },
  "Chicken Hyderabadi Biryani": {
    name: "চিকেন হায়দরাবাদী বিরিয়ানি",
    description: "দমে রাঁধা বিরিয়ানি, জাফরান, ভাজা পেঁয়াজ ও মুরগির মাংসের গভীর সুবাসে।",
  },
  "Beef Tehari": {
    name: "বিফ তেহারি",
    description: "গরুর মাংস ও হলুদ রঙের চাল — ঢাকার রাস্তার চেনা স্বাদ, বেশি ঝালে।",
  },
  "Prawn Pulao": {
    name: "চিংড়ি পোলাও",
    description: "ঘি-তে ভাজা সুগন্ধি চাল, চিংড়ি ও জাফরানের হালকা মসলায়।",
  },
  "Steamed Basmati Rice": {
    name: "বাসমতি ভাত",
    description: "সাদা বাসমতি চাল, সেদ্ধ — ঝরঝরে, প্রতিটি পদের সঙ্গে।",
  },
  "Vegetable Fried Rice": {
    name: "সবজি ফ্রাইড রাইস",
    description: "উচ্চ আঁচে নাড়িয়ে রান্না চাল, গাজর, বাঁধাকপি ও স্প্রিং পেঁয়াজে।",
  },
  "Lemon Rice": {
    name: "লেবু ভাত",
    description: "দক্ষিণী ধাঁচে লেবু, মুগ ডাল, কারি পাতা ও কাজু মেশানো হালকা ভাত।",
  },

  // ---------------------------------------------------- burgers & sandwiches
  "MATI Signature Beef Burger": {
    name: "মাটির সিগনেচার বিফ বার্গার",
    description: "১৮০ গ্রাম গরুর মাংসের প্যাটি, চেদার, ক্যারামেলাইজড পেঁয়াজ ও নিজস্ব সস ব্রিওশে রুটিতে।",
  },
  "Grilled Chicken Club Sandwich": {
    name: "গ্রিলড চিকেন ক্লাব স্যান্ডউইচ",
    description: "তিন স্তরের টোস্ট, গ্রিল করা মুরগি, বেকন স্টাইল বিফ, টমেটো ও মেয়োনিজ।",
  },
  "Smoky Paneer Burger": {
    name: "স্মোকি পনির বার্গার",
    description: "মসলায় মাখা পনিরের প্যাটি, বারবিকিউ সস ও কোলস্ল-এর সঙ্গে।",
  },
  "Crispy Fish Burger": {
    name: "মুচমুচে ফিশ বার্গার",
    description: "বেসনে ভাজা সাদা মাছ, টারটার সস ও লেটুস ব্রিওশে রুটিতে।",
  },
  "Beef Cheeseburger": {
    name: "বিফ চিজবার্গার",
    description: "ক্লাসিক চিজবার্গার — ডাবল চেদার, আচার ও সরিষা-মেয়োনিজ।",
  },
  "Chicken Shawarma Wrap": {
    name: "চিকেন শাওয়ারমা",
    description: "উল্লম্ব শিকে পোড়া মুরগি, সুমাক ও রসুনের সস পিটা রুটিতে জড়ানো।",
  },
  "Tuna Melt Sandwich": {
    name: "টুনা মেল্ট স্যান্ডউইচ",
    description: "টুনা মেয়োনিজ, ভাজা পেঁয়াজ ও গলিত চেদার — চাপ দিয়ে সেঁকা।",
  },

  // ------------------------------------------------------------ pizza & pasta
  "Margherita Pizza": {
    name: "মার্গারিটা পিৎজা",
    description: "টমেটো সস, ফ্রেশ মজারেলা ও তুলসী পাতা — নেওয়াপোলিটান ঘাঁটিতে, পাথরের চুলায়।",
  },
  "Chicken Tikka Pizza": {
    name: "চিকেন টিক্কা পিৎজা",
    description: "মসলায় মাখা টিক্কা, পেঁয়াজ ও সবুজ মরিচ, মজারেলা ও ধনে পাতায়।",
  },
  "Beef Pepperoni Pizza": {
    name: "বিফ পেপারোনি পিৎজা",
    description: "মসলাদার বিফ পেপারোনির স্তর, মজারেলা ও ওরিগানো।",
  },
  "Creamy Chicken Alfredo": {
    name: "ক্রিমি চিকেন আলফ্রেডো",
    description: "ফেটুচিনি পাস্তা, ক্রিম ও পারমেসানে মাখা, গ্রিল করা মুরগির সঙ্গে।",
  },
  "Penne Arrabbiata": {
    name: "পেনে আরাবিয়াতা",
    description: "ঝাল টমেটো ও রসুনের সসে পেনে, উপরে পারমেসান।",
  },
  "Beef Lasagna": {
    name: "বিফ লাজানিয়া",
    description: "স্তরে স্তরে পাস্তা, গরুর মাংসের রাগু ও বেচামেল সস, চুলায় সোনালি করে বেক করা।",
  },
  "Spaghetti Aglio e Olio": {
    name: "স্প্যাগেটি আজিও ই ওলিও",
    description: "রসুন, জলপাই তেল ও মরিচ — অল্প উপকরণে তৈরি ইতালিয়ান ক্লাসিক।",
  },

  // ------------------------------------------------------------------- drinks
  "Classic Mango Lassi": {
    name: "ম্যাংগো লাচ্ছি",
    description: "পাকা আম, দই ও সামান্য এলাচ — বরফ ঠান্ডা।",
  },
  "Fresh Lemonade": {
    name: "লেবুর শরবত",
    description: "তাজা লেবু, চিনি ও পুদিনা — গরমের দিনের সবচেয়ে সহজ আরাম।",
  },
  "Masala Cha": {
    name: "মসলা চা",
    description: "দুধ, আদা, এলাচ ও দারুচিনিতে রান্না চা।",
  },
  "Iced Filter Coffee": {
    name: "আইসড ফিল্টার কফি",
    description: "ধীরে ফোঁটা ফোঁটা কফি, দুধ ও বরফের সঙ্গে।",
  },
  "Cold Brew Coffee": {
    name: "কোল্ড ব্রিউ কফি",
    description: "বারো ঘণ্টা ঠান্ডায় ভেজানো কফি — মসৃণ, টকতা ছাড়া।",
  },
  "Sparkling Mint Cooler": {
    name: "স্পার্কলিং পুদিনা কুলার",
    description: "সোডা, পুদিনা ও লেবুর রিফ্রেশিং মিশ্রণ।",
  },
  "Bottled Water": {
    name: "বোতলজাত পানি",
    description: "সিল করা মিনারেল ওয়াটার, ৫০০ মিলি।",
  },

  // ------------------------------------------------------------------ desserts
  "Chocolate Lava Cake": {
    name: "চকলেট লাভা কেক",
    description: "গরম চকলেট কেক — ভেতরে গলিত চকলেট, সঙ্গে ভ্যানিলা আইসক্রিম।",
  },
  "Mango Cheesecake": {
    name: "ম্যাংগো চিজকেক",
    description: "মাখনের বিস্কুটের স্তরে আমের চিজকেক, ঠান্ডা পরিবেশিত।",
  },
  "Caramel Custard": {
    name: "ক্যারামেল কাস্টার্ড",
    description: "নরম কাস্টার্ড, উপরে ক্যারামেলের আস্তরণ।",
  },
  "Gulab Jamun (2 pcs)": {
    name: "গোলাপ জামুন (২টি)",
    description: "গরম গোলাপ জামুন, চিনির সিরায় ভেজানো।",
  },
  "Vanilla Bean Ice Cream": {
    name: "ভ্যানিলা আইসক্রিম",
    description: "প্রকৃত ভ্যানিলা বীজ দিয়ে তৈরি, দুধের মিষ্টি স্বাদে।",
  },
  "Pistachio Kulfi": {
    name: "পেস্তা কুলফি",
    description: "ঘন দুধ ও পেস্তায় তৈরি ঐতিহ্যবাহী কুলফি।",
  },
  "Tres Leches Slice": {
    name: "ট্রেস লেচে কেক",
    description: "তিন ধরনের দুধে ভেজানো স্পঞ্জ কেকের এক টুকরো।",
  },
};

/** Bengali restaurant profile for the guest menu header. */
export const BANGLA_RESTAURANT = {
  tagline: "ধীরে রাঁধা বাংলার স্বাদ, দ্রুত আপনার টেবিলে।",
  description:
    "মাটি কিচেন ধানমন্ডির একটি আধুনিক বাংলা রেস্টুরেন্ট। আমাদের কাচ্চি এখনও মাটির হাঁড়িতে সিল করা হয়, ভুনা চার ঘণ্টা ধীরে জ্বলে, আর প্রতিটি পদ অর্ডার অনুযায়ী তৈরি। স্ক্যান করুন, অর্ডার দিন — আমরা টেবিলে নিয়ে আসব।",
  address: "বাড়ি ৪২, রোড ২৭, ধানমন্ডি",
  city: "ঢাকা",
  taxLabel: "ভ্যাট",
  serviceChargeLabel: "সার্ভিস চার্জ",
} as const;

/** Every dish name in the English catalogue that has no Bengali entry yet. */
export function missingBangla(englishNames: string[]): string[] {
  return englishNames.filter((name) => !BANGLA_MENU[name]);
}

/** Every category name in the English catalogue that has no Bengali entry yet. */
export function missingBanglaCategories(englishNames: string[]): string[] {
  return englishNames.filter((name) => !BANGLA_CATEGORIES[name]);
}
