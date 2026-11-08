# MATI Kitchen — menu image verification report

Generated after the demo database rebuild on 2026-11-08.

- **Commit:** `cb20cbe`
- **Demo tenant:** `1eb6fd7d-ef03-4cdb-afdc-d94f72f33dd4` (MATI Kitchen)
- **Menu items:** 50 · **Distinct photographs:** 50 · **Reused images:** 0

Contact sheet: [`docs/menu-contact-sheet.png`](menu-contact-sheet.png) — all 50
photographs in category order, inspected visually.

## Duplicate audit

```
50 menu items
distinct image paths assigned  : 50
items without an image         : 0
image paths used more than once: 0
unique image files (sha256)    : 50 of 50
perceptually near-identical    : 0 pair(s) at <=6/64 bits
seed items naming a photograph : 50/50
PASSED
```

SHA-256 alone would not catch the original defect — the same photograph
re-encoded at a different quality has a different hash. The perceptual check is
what matters: each image is reduced to a 64-bit difference hash and compared
against every other image. Zero pairs fall within the 6/64-bit threshold, so no
two dishes share a photograph, and none are the same picture re-cropped.

## Rendering verification

| Check | Result |
| --- | --- |
| Customer menu (`/q/<token>` → `/menu/mati-kitchen`) | HTTP 200, 50 distinct images, 0 legacy category jpgs |
| Image URLs | 50/50 return 200, `image/webp`, >10 KiB |
| Dish name ↔ image filename | 0 mismatches across 50 rendered `<img>` tags |
| Owner dashboard `/dashboard/menu` | HTTP 200, 50 previews, 50 distinct, 0 mismatches |
| Image dimensions | every file 1200×1200 WebP quality 82 |

## All 50 photographs

| # | Food Item | Category | Image Filename | Size | SHA-256 | Unique Image Verified | Rendering Verified |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Chicken Shashlik Skewers | Starters | `chicken-shashlik-skewers.webp` | 126 KiB | e31d4138d8aa | ✅ unique | ✅ 200 / 50-of-50 |
| 2 | Peri Peri Chicken Wings | Starters | `peri-peri-chicken-wings.webp` | 143 KiB | 4ba29e27bd55 | ✅ unique | ✅ 200 / 50-of-50 |
| 3 | Crispy Chilli Squid | Starters | `crispy-chilli-squid.webp` | 131 KiB | f19b536df441 | ✅ unique | ✅ 200 / 50-of-50 |
| 4 | Paneer Tikka Bites | Starters | `paneer-tikka-bites.webp` | 112 KiB | 0dd99eb7484d | ✅ unique | ✅ 200 / 50-of-50 |
| 5 | Beef Seekh Kebab | Starters | `beef-seekh-kebab.webp` | 126 KiB | d2c71ac2bcf6 | ✅ unique | ✅ 200 / 50-of-50 |
| 6 | Crispy Onion Rings | Starters | `crispy-onion-rings.webp` | 147 KiB | 18fa67a75869 | ✅ unique | ✅ 200 / 50-of-50 |
| 7 | Vegetable Samosa Platter | Starters | `vegetable-samosa-platter.webp` | 122 KiB | 3379e4084f89 | ✅ unique | ✅ 200 / 50-of-50 |
| 8 | Beef Bhuna | Main Course | `beef-bhuna.webp` | 134 KiB | 461a0283a3cd | ✅ unique | ✅ 200 / 50-of-50 |
| 9 | Chicken Korma | Main Course | `chicken-korma.webp` | 117 KiB | 2a6f901ecb99 | ✅ unique | ✅ 200 / 50-of-50 |
| 10 | Mutton Rogan Josh | Main Course | `mutton-rogan-josh.webp` | 151 KiB | 82a9b461d3e7 | ✅ unique | ✅ 200 / 50-of-50 |
| 11 | Butter Chicken | Main Course | `butter-chicken.webp` | 116 KiB | 9deb8f24f0cd | ✅ unique | ✅ 200 / 50-of-50 |
| 12 | Prawn Malai Curry | Main Course | `prawn-malai-curry.webp` | 123 KiB | fffc1bdd144e | ✅ unique | ✅ 200 / 50-of-50 |
| 13 | Chicken Tikka Masala | Main Course | `chicken-tikka-masala.webp` | 148 KiB | 6e7873c80db5 | ✅ unique | ✅ 200 / 50-of-50 |
| 14 | Dal Makhani | Main Course | `dal-makhani.webp` | 105 KiB | 7cd75610c3a6 | ✅ unique | ✅ 200 / 50-of-50 |
| 15 | Aloo Gobi Masala | Main Course | `aloo-gobi-masala.webp` | 105 KiB | 8db93f9f7bcb | ✅ unique | ✅ 200 / 50-of-50 |
| 16 | Mutton Kacchi Biryani | Rice & Biryani | `mutton-kacchi-biryani.webp` | 135 KiB | 6853690e5b17 | ✅ unique | ✅ 200 / 50-of-50 |
| 17 | Chicken Hyderabadi Biryani | Rice & Biryani | `chicken-hyderabadi-biryani.webp` | 140 KiB | 4fd76ff5cb38 | ✅ unique | ✅ 200 / 50-of-50 |
| 18 | Beef Tehari | Rice & Biryani | `beef-tehari.webp` | 167 KiB | 4e4e605e4390 | ✅ unique | ✅ 200 / 50-of-50 |
| 19 | Prawn Pulao | Rice & Biryani | `prawn-pulao.webp` | 131 KiB | dad11d8a35f4 | ✅ unique | ✅ 200 / 50-of-50 |
| 20 | Steamed Basmati Rice | Rice & Biryani | `steamed-basmati-rice.webp` | 91 KiB | d195bb8d7024 | ✅ unique | ✅ 200 / 50-of-50 |
| 21 | Vegetable Fried Rice | Rice & Biryani | `vegetable-fried-rice.webp` | 128 KiB | 58fd9e50c8b3 | ✅ unique | ✅ 200 / 50-of-50 |
| 22 | Lemon Rice | Rice & Biryani | `lemon-rice.webp` | 103 KiB | f3db68cd0048 | ✅ unique | ✅ 200 / 50-of-50 |
| 23 | MATI Signature Beef Burger | Burgers & Sandwiches | `mati-signature-beef-burger.webp` | 142 KiB | f1fedd997545 | ✅ unique | ✅ 200 / 50-of-50 |
| 24 | Grilled Chicken Club Sandwich | Burgers & Sandwiches | `grilled-chicken-club-sandwich.webp` | 146 KiB | 102e2ed6f208 | ✅ unique | ✅ 200 / 50-of-50 |
| 25 | Smoky Paneer Burger | Burgers & Sandwiches | `smoky-paneer-burger.webp` | 118 KiB | 57d990a89045 | ✅ unique | ✅ 200 / 50-of-50 |
| 26 | Crispy Fish Burger | Burgers & Sandwiches | `crispy-fish-burger.webp` | 165 KiB | 8e1b70709751 | ✅ unique | ✅ 200 / 50-of-50 |
| 27 | Beef Cheeseburger | Burgers & Sandwiches | `beef-cheeseburger.webp` | 143 KiB | ef672dd906fc | ✅ unique | ✅ 200 / 50-of-50 |
| 28 | Chicken Shawarma Wrap | Burgers & Sandwiches | `chicken-shawarma-wrap.webp` | 155 KiB | f45e638a865c | ✅ unique | ✅ 200 / 50-of-50 |
| 29 | Tuna Melt Sandwich | Burgers & Sandwiches | `tuna-melt-sandwich.webp` | 139 KiB | 5f0d158ff6b0 | ✅ unique | ✅ 200 / 50-of-50 |
| 30 | Margherita Pizza | Pizza & Pasta | `margherita-pizza.webp` | 169 KiB | a6c693ebcf03 | ✅ unique | ✅ 200 / 50-of-50 |
| 31 | Chicken Tikka Pizza | Pizza & Pasta | `chicken-tikka-pizza.webp` | 187 KiB | cffba1de422c | ✅ unique | ✅ 200 / 50-of-50 |
| 32 | Beef Pepperoni Pizza | Pizza & Pasta | `beef-pepperoni-pizza.webp` | 157 KiB | 48f45b5d9e41 | ✅ unique | ✅ 200 / 50-of-50 |
| 33 | Creamy Chicken Alfredo | Pizza & Pasta | `creamy-chicken-alfredo.webp` | 118 KiB | 08d7e0b5ab14 | ✅ unique | ✅ 200 / 50-of-50 |
| 34 | Penne Arrabbiata | Pizza & Pasta | `penne-arrabbiata.webp` | 133 KiB | 972252bea35e | ✅ unique | ✅ 200 / 50-of-50 |
| 35 | Beef Lasagna | Pizza & Pasta | `beef-lasagna.webp` | 171 KiB | 939acb2422af | ✅ unique | ✅ 200 / 50-of-50 |
| 36 | Spaghetti Aglio e Olio | Pizza & Pasta | `spaghetti-aglio-e-olio.webp` | 124 KiB | c533cc1dd06e | ✅ unique | ✅ 200 / 50-of-50 |
| 37 | Classic Mango Lassi | Drinks | `classic-mango-lassi.webp` | 112 KiB | 5d4470148d34 | ✅ unique | ✅ 200 / 50-of-50 |
| 38 | Fresh Lemonade | Drinks | `fresh-lemonade.webp` | 125 KiB | 0eaae6f2fe68 | ✅ unique | ✅ 200 / 50-of-50 |
| 39 | Masala Cha | Drinks | `masala-cha.webp` | 115 KiB | eb90c993a97d | ✅ unique | ✅ 200 / 50-of-50 |
| 40 | Iced Filter Coffee | Drinks | `iced-filter-coffee.webp` | 111 KiB | 38262d05e9ba | ✅ unique | ✅ 200 / 50-of-50 |
| 41 | Cold Brew Coffee | Drinks | `cold-brew-coffee.webp` | 116 KiB | 198234fca797 | ✅ unique | ✅ 200 / 50-of-50 |
| 42 | Sparkling Mint Cooler | Drinks | `sparkling-mint-cooler.webp` | 120 KiB | bdeff17e0b8c | ✅ unique | ✅ 200 / 50-of-50 |
| 43 | Bottled Water | Drinks | `bottled-water.webp` | 117 KiB | d3c7422faed4 | ✅ unique | ✅ 200 / 50-of-50 |
| 44 | Chocolate Lava Cake | Desserts | `chocolate-lava-cake.webp` | 106 KiB | 05ac00360444 | ✅ unique | ✅ 200 / 50-of-50 |
| 45 | Mango Cheesecake | Desserts | `mango-cheesecake.webp` | 79 KiB | 5f323b2fa18e | ✅ unique | ✅ 200 / 50-of-50 |
| 46 | Caramel Custard | Desserts | `caramel-custard.webp` | 113 KiB | 3dae0e6347c7 | ✅ unique | ✅ 200 / 50-of-50 |
| 47 | Gulab Jamun (2 pcs) | Desserts | `gulab-jamun.webp` | 101 KiB | 58dbab007200 | ✅ unique | ✅ 200 / 50-of-50 |
| 48 | Vanilla Bean Ice Cream | Desserts | `vanilla-bean-ice-cream.webp` | 128 KiB | 4d99e702ed32 | ✅ unique | ✅ 200 / 50-of-50 |
| 49 | Pistachio Kulfi | Desserts | `pistachio-kulfi.webp` | 134 KiB | 741dfc9bd8cf | ✅ unique | ✅ 200 / 50-of-50 |
| 50 | Tres Leches Slice | Desserts | `tres-leches-slice.webp` | 95 KiB | 73277d5d01f1 | ✅ unique | ✅ 200 / 50-of-50 |

Every row was confirmed visually on the contact sheet, not inferred from the
database. "Rendering Verified" means the photograph was seen in the rendered
customer menu and the item's own image URL answered 200 as WebP.

## How this set replaced the original defect

The audit that started this work found **50 dishes sharing 7 images** —
`curry.jpg` used by 8 unrelated dishes, and six other category images by 7 each,
so a Vegetable Samosa Platter displayed a chicken-wing photo. Each dish now names
its own photograph in `menu-data.ts`, and the seed refuses to fall back to
another dish's picture: a missing file yields no image rather than a wrong one.

## Safety properties of the assignment step

`scripts/apply-menu-images.ts` is image-only and proves it. It hashes eleven
protected tables before and after the update — restaurants, categories, dining
tables, QR tokens, orders, order items, order status history, customers,
settings, members, and every `menu_items` column except `image_path` and
`updated_at` — and exits non-zero if anything else moved. `updated_at` is
excluded because the `touch_updated_at` trigger rewrites it on any update; that
distinction is the difference between a check that means something and one that
can never pass. The script is idempotent.
