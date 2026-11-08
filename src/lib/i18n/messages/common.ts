/**
 * Bengali dictionary — Common layer.
 *
 * Written for a restaurant floor in Bangladesh, not translated word-for-word
 * from English. Where an English term is what staff actually say ("QR", "ETA"),
 * it is kept; everything else uses the words a waiter or owner would use.
 *
 * Register: the owner addresses staff politely (আপনি), staff address guests politely
 * (আপনি), and the interface never blames the user for an error.
 */
export const common = {
  // ---------------------------------------------------------------- app shell
  "app.name": "মেনুপাইলট",
  "app.tagline": "রেস্টুরেন্ট চালান, ঝামেলা ছাড়াই",
  "app.description":
    "মেনুপাইলট রেস্টুরেন্টের জন্য একটি সম্পূর্ণ সিস্টেম — টেবিলের QR, রান্নাঘরের স্ক্রিন, অর্ডার অনুমোদন, কর্মচারী ও হিসাব, সব এক জায়গায়।",
  "app.poweredBy": "মেনুপাইলট দ্বারা পরিচালিত",

  // -------------------------------------------------------------------- actions
  "action.save": "সংরক্ষণ করুন",
  "action.saving": "সংরক্ষণ হচ্ছে…",
  "action.saved": "সংরক্ষণ হয়েছে",
  "action.cancel": "বাতিল",
  "action.close": "বন্ধ করুন",
  "action.back": "ফিরে যান",
  "action.next": "পরবর্তী",
  "action.previous": "পূর্ববর্তী",
  "action.finish": "সম্পন্ন করুন",
  "action.confirm": "নিশ্চিত করুন",
  "action.delete": "মুছুন",
  "action.remove": "সরান",
  "action.edit": "সম্পাদনা",
  "action.add": "যোগ করুন",
  "action.retry": "আবার চেষ্টা করুন",
  "action.refresh": "রিফ্রেশ",
  "action.search": "খুঁজুন",
  "action.clear": "পরিষ্কার করুন",
  "action.view": "দেখুন",
  "action.viewAll": "সব দেখুন",
  "action.submit": "জমা দিন",
  "action.send": "পাঠান",
  "action.reply": "উত্তর দিন",
  "action.continue": "চালিয়ে যান",
  "action.yes": "হ্যাঁ",
  "action.no": "না",
  "action.ok": "ঠিক আছে",
  "action.optional": "ঐচ্ছিক",
  "action.required": "আবশ্যক",

  // --------------------------------------------------------------------- states
  "state.loading": "লোড হচ্ছে…",
  "state.saving": "সংরক্ষণ হচ্ছে…",
  "state.sending": "পাঠানো হচ্ছে…",
  "state.searching": "খোঁজা হচ্ছে…",
  "state.empty": "এখনও কিছু নেই",
  "state.error": "কিছু একটা সমস্যা হয়েছে",
  "state.offline": "সার্ভারের সঙ্গে সংযোগ নেই",
  "state.required": "এই তথ্যটি আবশ্যক",
  "state.updating": "হালনাগাদ হচ্ছে…",
  "state.live": "সরাসরি",
  "state.stale": "পুরোনো তথ্য",
  "state.unknown": "অজানা",
  "state.na": "প্রযোজ্য নয়",

  // ------------------------------------------------------------------ feedback
  "feedback.saved": "সফলভাবে সংরক্ষণ হয়েছে।",
  "feedback.updated": "হালনাগাদ হয়েছে।",
  "feedback.deleted": "মুছে ফেলা হয়েছে।",
  "feedback.copied": "কপি হয়েছে।",
  "feedback.sent": "পাঠানো হয়েছে।",
  "feedback.tryAgain": "একটু পরে আবার চেষ্টা করুন।",

  // ------------------------------------------------------------------ language
  "language.label": "ভাষা",
  "language.bengali": "বাংলা",
  "language.english": "English",

  // --------------------------------------------------------------- units / money
  "unit.minute": "মিনিট",
  "unit.minutes": "মিনিট",
  "unit.item": "আইটেম",
  "unit.items": "আইটেম",
  "unit.order": "অর্ডার",
  "unit.orders": "অর্ডার",
  "unit.day": "দিন",
  "unit.days": "দিন",
  "unit.table": "টেবিল",
  "unit.people": "জন",
  "unit.review": "মতামত",
  "unit.reviews": "মতামত",
  "unit.sold": "বিক্রি",
  "unit.plates": "প্লেট",

  // -------------------------------------------------------------------- generic
  "generic.and": "এবং",
  "generic.or": "অথবা",
  "generic.all": "সব",
  "generic.none": "কোনোটি নয়",
  "generic.more": "আরও",
  "generic.less": "কম",
  "generic.total": "মোট",
  "generic.subtotal": "উপমোট",
  "generic.tax": "কর",
  "generic.discount": "ছাড়",
  "generic.status": "অবস্থা",
  "generic.date": "তারিখ",
  "generic.time": "সময়",
  "generic.name": "নাম",
  "generic.phone": "মোবাইল নম্বর",
  "generic.note": "নোট",
  "generic.reason": "কারণ",
  "generic.role": "ভূমিকা",
  "generic.email": "ইমেইল",
  "generic.password": "পাসওয়ার্ড",
  "generic.amount": "পরিমাণ",
  "generic.quantity": "সংখ্যা",
  "generic.price": "দাম",
  "generic.category": "ক্যাটাগরি",
  "generic.today": "আজ",
  "generic.yesterday": "গতকাল",
  "generic.justNow": "এইমাত্র",
  "generic.summary": "সারসংক্ষেপ",
  "generic.details": "বিস্তারিত",
} as const;
