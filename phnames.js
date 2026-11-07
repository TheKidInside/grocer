// Philippine receipts squeeze each product into ~20 characters: "PF CB 210G" is
// Purefoods Corned Beef, "HNTSPRK BNS230G" Hunt's Pork & Beans, "WK HCAKE W-SYRUP"
// White King pancake mix. expandName turns those back into the name a shopper
// would write on a list, plus a category when the product makes it obvious.
//
// How it reads a line (pure string rules, no libraries):
//   1. glue the words together ("HNTSPRKBNS230G") - receipts and OCR drop spaces
//      at random, so patterns never rely on them;
//   2. find the brand (BRANDS); short codes like PF / DM / WK only count at the
//      start of the line, where receipts print them;
//   3. find the product in what's left (PRODUCTS, first match wins, so specific
//      entries sit above general ones);
//   4. nothing known? expand the abbreviations word by word (WORDS).
// Sizes ("230G", "1L") are left out of the name; the receipt text keeps them.

// Squeezed spelling of a word: vowels after the first letter and doubled letters
// become optional, so sq('PORK') matches PORK and PRK, sq('BEANS') BEANS and BNS.
function sq(word) {
  let out = word[0];
  for (let i = 1; i < word.length; i++) {
    const c = word[i];
    out += /[AEIOU]/.test(c) || c === word[i - 1] ? `${c}?` : c;
  }
  return out;
}
// A phrase of squeezed words, glued together: ab('PORK BEANS') -> /PO?RKBE?A?NS/.
// Under 4 distinct consonants the squeezed form is too short to trust ("TS" for
// TISSUE, "VN" for VIENNA would fire inside other words), so it stays literal.
const ab = (phrase) => {
  const skeleton = phrase.replace(/[^A-Z]/g, '').replace(/(?!^)[AEIOU]/g, '').replace(/(.)\1+/g, '$1');
  return skeleton.length < 4 ? phrase.replace(/ /g, '') : phrase.split(' ').map(sq).join('');
};
const re = (...parts) => new RegExp(parts.map((p) => (p instanceof RegExp ? p.source : p)).join('|'));

// [name, regex on the glued line, default product, category]
// A brand with a category only accepts products of that category (Cream Silk COND
// is conditioner, never condensed milk). A default product is used when the
// line names no product ("DATUPUTI PRESPACK 1L" is the vinegar).
const BRANDS = [
  ['American Garden', re(ab('AMERICAN GARDEN')), null, 'Pantry'],
  ['Gardenia', /GARDENIA|GRDNA|^GAR(?!LIC|BAGE|DEN|NI)/, 'Bread', 'Bakery'],
  ['Del Monte', re(ab('DEL MONTE'), /^DM(?=[A-Z])/), null, null],
  ['Purefoods', re(ab('PUREFOODS'), /^PF(?=[A-Z])/), null, null],
  ['White King', re(ab('WHITE KING'), /^WK(?=[A-Z])/), null, null],
  ["Hunt's", /^HU?NTS|HUNTS/, null, 'Pantry'],
  ['Alaska', /ALASKA|^ALSK/, null, 'Dairy & Eggs'],
  ['Bear Brand', re(ab('BEAR BRAND'), /^BRBRND/), 'Powdered Milk', 'Dairy & Eggs'],
  ['Birch Tree', re(ab('BIRCH TREE')), 'Powdered Milk', 'Dairy & Eggs'],
  ['Nido', /^NIDO/, 'Powdered Milk', 'Dairy & Eggs'],
  ['Nestle', /NESTLE|^NSTL/, null, null],
  ['Milo', /^MILO/, 'Chocolate Drink', 'Drinks'],
  ['Nescafe', re(ab('NESCAFE')), 'Coffee', 'Drinks'],
  ['Kopiko', /KOPIKO/, 'Coffee', 'Drinks'],
  ['Great Taste', /GREATTASTE|^GRTTST/, 'Coffee', 'Drinks'],
  ['Tang', /^TANG/, 'Powdered Juice', 'Drinks'],
  ["Foster Clark's", /FO?STE?R?CLA?R/, 'Powdered Juice', 'Drinks'],
  ['Zesto', /^ZESTO/, 'Juice Drink', 'Drinks'],
  ['Coca-Cola', /^COKE|COCACOLA/, 'Soft Drink', 'Drinks'],
  ['Sprite', /^SPRITE/, 'Soft Drink', 'Drinks'],
  ['Royal', /^ROYAL(?!SPAG|PASTA)/, 'Soft Drink', 'Drinks'],
  ['Pepsi', /^PEPSI/, 'Soft Drink', 'Drinks'],
  ['C2', /^C2(?=[A-Z])/, 'Iced Tea', 'Drinks'],
  ['Wilkins', /WILKINS/, 'Water', 'Drinks'],
  ["Lady's Choice", re(ab('LADYS CHOICE'), /^LC(?=[A-Z])/), null, null],
  ['Best Foods', re(ab('BEST FOODS'), /^BF(?=[A-Z])/), null, null],
  ['Datu Puti', re(ab('DATU PUTI'), /^DP(?=[A-Z])/), 'Vinegar', 'Pantry'],
  ['Silver Swan', re(ab('SILVER SWAN'), /^SSWAN/), 'Soy Sauce', 'Pantry'],
  ['Marca Pina', /MARCAPINA/, 'Soy Sauce', 'Pantry'],
  ['UFC', /^UFC/, 'Banana Ketchup', 'Pantry'],
  ['Jufran', /JUFRAN/, 'Banana Ketchup', 'Pantry'],
  ["Mama Sita's", re(ab('MAMA SITA'), /^MSITA/), null, 'Pantry'],
  ['Knorr', /KNORR/, null, 'Pantry'],
  ['Maggi', /MAGGI/, null, 'Pantry'],
  ['Ajinomoto', /AJINOMOTO/, 'Seasoning (MSG)', 'Pantry'],
  ['Coco Mama', /COCOMA?MA|^COCOMM/, 'Coconut Milk', 'Pantry'],
  ['Century', re(ab('CENTURY')), 'Tuna', 'Pantry'],
  ['Ligo', /^LIGO/, 'Sardines', 'Pantry'],
  ['555', /^555/, 'Sardines', 'Pantry'],
  ['Mega', /^MEGA(?=[A-Z])/, 'Sardines', 'Pantry'],
  ['San Marino', /SANMARINO/, 'Tuna', 'Pantry'],
  ['Argentina', /ARGENTINA|^ARG(?=[A-Z])/, 'Corned Beef', 'Pantry'],
  ['CDO', /^CDO/, null, null],
  ['Spam', /^SPAM/, 'Luncheon Meat', 'Pantry'],
  ['Ma Ling', /MALING/, 'Luncheon Meat', 'Pantry'],
  ['Lucky Me', /LUCKYME|^LM(?=PC|PANCIT|PNCT|CNTN|CANTON|INST|BATCHOY|SUPREME|GOGO)/, 'Instant Noodles', 'Pantry'],
  ['Payless', /PAYLESS/, 'Instant Noodles', 'Pantry'],
  ['Nissin', /NISSIN/, 'Instant Noodles', 'Pantry'],
  ['Quaker', /QUAKER/, 'Oats', 'Pantry'],
  ['Magnolia', /MAGNOLIA|^MAG(?!IC|GI|NUM)/, null, null],
  ['Selecta', /SELECTA/, 'Ice Cream', 'Frozen'],
  ['Eden', /^EDEN/, 'Cheese', 'Dairy & Eggs'],
  ['Dari Creme', /DARICREME/, 'Margarine', 'Dairy & Eggs'],
  ['Goya', /^GOYA/, null, null],
  ['Oishi', /OISHI|^OKI(?=[A-Z])/, null, 'Snacks'],
  ["Jack 'n Jill", /JACKNJILL|^(JNJ|JJ)(?=[A-Z])/, null, 'Snacks'],
  ['Granny Goose', /GRANNYGOOSE|^GG(?=[A-Z])/, null, 'Snacks'],
  ['Rebisco', /REBISCO/, 'Crackers', 'Snacks'],
  ['Fibisco', /FIBISCO|^FBSCO/, null, 'Snacks'],
  ['Zonrox', /ZONROX|ZNRX/, 'Bleach', 'Household'],
  ['Ambi Pur', /AMBIPUR/, 'Air Freshener', 'Household'],
  ['Glade', /^GLADE/, 'Air Freshener', 'Household'],
  ['Cheers', /^CHEERS/, null, 'Household'],
  ['Downy', /DOWNY|^DWNY/, 'Fabric Conditioner', 'Household'],
  ['Surf', /^SURF/, 'Laundry Detergent', 'Household'],
  ['Tide', /^TIDE/, 'Laundry Detergent', 'Household'],
  ['Ariel', /ARIEL/, 'Laundry Detergent', 'Household'],
  ['Breeze', /^BREEZE/, 'Laundry Detergent', 'Household'],
  ['Champion', /^CHAMPION/, 'Laundry Detergent', 'Household'],
  ['Joy', /^JOY(?!TISSUE)/, 'Dishwashing Liquid', 'Household'],
  ['Axion', /AXION/, 'Dishwashing Paste', 'Household'],
  ['Baygon', /BAYGON/, 'Insect Spray', 'Household'],
  ['Hapee', /HAPEE/, 'Toothpaste', 'Personal Care'],
  ['Colgate', /COLGATE/, 'Toothpaste', 'Personal Care'],
  ['Close-Up', /CLOSEUP/, 'Toothpaste', 'Personal Care'],
  ['Safeguard', re(ab('SAFEGUARD'), /^SFGRD/), 'Bath Soap', 'Personal Care'],
  ['Cream Silk', /CREAMSILK|^CRMSLK/, 'Conditioner', 'Personal Care'],
  ['Sunsilk', /SUNSILK/, 'Shampoo', 'Personal Care'],
  ['Head & Shoulders', /HEADSHOULDERS|HEADANDSHOULDERS/, 'Shampoo', 'Personal Care'],
  ['Rexona', /REXONA/, 'Deodorant', 'Personal Care'],
  ['Old Spice', /O?LDSPI?CE|^OLDSP/, null, 'Personal Care'],
  ['Modess', /MODESS/, 'Sanitary Napkins', 'Personal Care'],
  ['Whisper', /WHISPER/, 'Sanitary Napkins', 'Personal Care'],
  ['EQ', /^EQ(?=DRY|PLUS|COLORS|PANTS)/, 'Diapers', 'Baby'],
  ['Huggies', /HUGGIES/, 'Diapers', 'Baby'],
  ['Pampers', /PAMPERS/, 'Diapers', 'Baby'],
  ['MamyPoko', /MAMYPOKO/, 'Diapers', 'Baby'],
  ['Lactum', /LACTUM/, 'Milk Formula', 'Baby'],
  ['Bonna', /^BONNA/, 'Milk Formula', 'Baby'],
  ['Promil', /PROMIL/, 'Milk Formula', 'Baby'],
  ['Cerelac', /CERELAC/, 'Baby Cereal', 'Baby'],
].map(([name, rx, product, cat]) => ({ name, re: rx, product, cat }));

// [name, category, regex on the line after the brand, only with a brand]
// Order matters: snacks whose names hold other product words (Richeese wafer,
// Lemon Square cheesecake) come before Cheese; sauces before Spaghetti; etc.
const PRODUCTS = [
  // Snacks
  ['SkyFlakes Crackers', 'Snacks', /SKYFLA?KE?/],
  ['Richeese Wafer', 'Snacks', /RI?CHE?E?SE?W/],
  ['Lemon Square Cheesecake', 'Snacks', /^LSCHE?E?S|LEMONSQ/],
  ['Piattos', 'Snacks', /PIATTOS|(^|IN|JJ|JNJ)PTS/],
  ['Quake Overload', 'Snacks', /QUAKE(?!R)/],
  ['Nova', 'Snacks', /^NOVA(?!LICHES)/],
  ['Chippy', 'Snacks', /CHIPPY/],
  ['Oishi Pillows', 'Snacks', re(ab('PILLOWS'))],
  ['Oishi Ridges', 'Snacks', /RIDGES/],
  ['Oishi Prawn Crackers', 'Snacks', re(ab('PRAWN CRACKERS'))],
  ['Tortillos', 'Snacks', /TORTILLOS|TRTI/],
  ['Choco Mucho', 'Snacks', re(ab('CHOCO MUCHO'))],
  ['Cloud 9', 'Snacks', /CLOUD9/],
  ['Boy Bawang', 'Snacks', re(ab('BOY BAWANG'))],
  ['Chicharon', 'Snacks', re(ab('CHICHARON'))],
  ['Salted Egg Chips', 'Snacks', /SALTEDEGG|SLTE[CG]G/],
  ['Marshmallows', 'Snacks', re(ab('MARSHMALLOWS'), /MALLOWS|MLLWS/)],
  ['Wafer', 'Snacks', re(ab('WAFER'), /WFR/)],
  ['Crackers', 'Snacks', re(ab('CRACKERS'), /BISCUIT/)],
  // Canned and ready food
  ['Corned Beef', 'Pantry', re(/^CB(\d|EEF|$)/, /CBEEF/, ab('CORNED BEEF'))],
  ['Luncheon Meat', 'Pantry', re(/^LM(\d|$)/, ab('LUNCHEON'))],
  ['Meat Loaf', 'Pantry', re(ab('MEAT LOAF'))],
  ['Vienna Sausage', 'Pantry', /VIENNA|VNNA/],
  ['Liver Spread', 'Pantry', re(`${ab('LIVER')}SPR`)],
  ['Pork & Beans', 'Pantry', re(`${sq('PORK')}(N|AND)?${sq('BEANS')}`)],
  ['Sardines', 'Pantry', re(ab('SARDINES'))],
  ['Tuna', 'Pantry', /TUNA/],
  ['Shiitake Mushrooms', 'Pantry', re(ab('SHIITAKE'))],
  ['Mushrooms', 'Pantry', re(ab('MUSHROOMS'))],
  ['Pineapple Juice', 'Drinks', re(`${ab('PINEAPPLE')}${sq('JUICE')}`, /PNPLJ/)],
  ['Pineapple', 'Pantry', re(ab('PINEAPPLE'), /INEAPPLE|PNPL|PNAPL/), true],
  ['Pineapple', 'Produce', re(ab('PINEAPPLE'), /PINYA/)],
  ['Fruit Cocktail', 'Pantry', re(ab('FRUIT COCKTAIL'))],
  ['Nata de Coco', 'Pantry', re(ab('NATA DE COCO'), /NATADECC/)],
  ['Kaong', 'Pantry', /KAONG/],
  ['Coconut Milk', 'Pantry', re(/GATA/, ab('COCONUT MILK'), /COCOMA?MA|COCOMM/)],
  // Pasta, noodles, rice
  ['Pasta Sauce', 'Pantry', re(`PASTA${sq('SAUCE')}`)],
  ['Spaghetti Sauce', 'Pantry', re(ab('SPAGHETTI SAUCE'), /SPAGSC/)],
  ['Tomato Sauce', 'Pantry', re(ab('TOMATO SAUCE'))],
  ['Tomato Paste', 'Pantry', re(ab('TOMATO PASTE'))],
  ['Mac & Cheese', 'Pantry', re(/PASTAMCH/, `${ab('MAC')}(N|AND)?${sq('CHEESE')}`, /MACCHZ/)],
  ['Macaroni', 'Pantry', re(ab('MACARONI'), /PASTAM+AC|ELBOWMAC/)],
  ['Spaghetti', 'Pantry', re(ab('SPAGHETTI'))],
  ['Pasta', 'Pantry', /PASTA/],
  ['Pancit Canton', 'Pantry', re(ab('PANCIT CANTON'), ab('CANTON'))],
  ['Bihon', 'Pantry', re(ab('BIHON'))],
  ['Sotanghon', 'Pantry', re(ab('SOTANGHON'))],
  ['Instant Noodles', 'Pantry', /NOODLES?|^NDLS?|MAMI|BATCHOY|SUPERCUP/],
  ['Rice', 'Pantry', /^(WHITE|BROWN|JASMINE|BASMATI|DINORADO|SINANDOMENG|WELLMILLED|PREMIUM)?RICE(?!CRACK|CAKE|BRAN|PAPER)|BIGAS|DINORADO|SINANDOMENG|MALAGKIT/],
  ['Oats', 'Pantry', /OATS|OATMEAL/],
  // Sauces and seasoning
  ['Soy Sauce', 'Pantry', re(ab('SOY SAUCE'), /^SOY|TOYO/)],
  ['Fish Sauce', 'Pantry', re(/PATIS/, ab('FISH SAUCE'))],
  ['Oyster Sauce', 'Pantry', /OYSTE?R/],
  ['Vinegar', 'Pantry', re(ab('VINEGAR'), /SUKA/)],
  ['Adobo', 'Pantry', /^ADO?BO?/],
  ['Banana Ketchup', 'Pantry', re(`${ab('BANANA')}(${ab('KETCHUP')}|${ab('CATSUP')})`)],
  ['Tomato Ketchup', 'Pantry', re(`${ab('TOMATO')}(${ab('KETCHUP')}|${ab('CATSUP')})`)],
  ['Ketchup', 'Pantry', re(ab('KETCHUP'), ab('CATSUP'))],
  ['Sandwich Spread', 'Pantry', re(`${ab('SANDWICH')}SPR`)],
  ['Mayonnaise', 'Pantry', /MA?YO/],
  ['Mustard', 'Pantry', re(ab('MUSTARD'))],
  ['Peanut Butter', 'Pantry', re(ab('PEANUT BUTTER'))],
  ['Liquid Seasoning', 'Pantry', re(ab('LIQUID SEASONING'))],
  ['Sinigang Mix', 'Pantry', re(ab('SINIGANG'))],
  ['Magic Sarap', 'Pantry', re(ab('MAGIC SARAP'))],
  ['Bouillon Cubes', 'Pantry', /BOUILLON|BULLION|(BEEF|CHICKEN|CHKN|PORK|SHRIMP)CUBES?/],
  ['Seasoning (MSG)', 'Pantry', /VETSIN|^MSG/],
  ['Chili Flakes', 'Pantry', re(ab('CHILI FLAKES'))],
  ['Iodized Salt', 'Pantry', re(ab('IODIZED'))],
  ['Salt', 'Pantry', /^SALT|ROCKSALT|SEASALT/],
  ['Brown Sugar', 'Pantry', re(ab('BROWN SUGAR'))],
  ['White Sugar', 'Pantry', re(ab('WHITE SUGAR'), /REFINEDSUGAR/)],
  ['Sugar', 'Pantry', /SUGAR/],
  ['Cooking Oil', 'Pantry', re(ab('COOKING OIL'), /PALMOIL|VEGOIL|CANOLA|COCONUTOIL|^OIL/)],
  // Baking
  ['All-Purpose Cream', 'Dairy & Eggs', re(ab('ALL PURPOSE CREAM'), /ALLPRPSCRM|APCREAM/)],
  ['All-Purpose Flour', 'Pantry', re(ab('ALL PURPOSE FLOUR'), /ALLPRPS/)],
  ['Flour', 'Pantry', /FLOUR|FLR/],
  ['Baking Powder', 'Pantry', re(ab('BAKING POWDER'), /BPWDE?R|BPOWDER/)],
  ['Baking Soda', 'Pantry', re(ab('BAKING SODA'))],
  ['Cocoa Powder', 'Pantry', /COCOA/],
  ['Cornstarch', 'Pantry', re(ab('CORNSTARCH'))],
  ['Brownie Mix', 'Pantry', re(ab('BROWNIE'), /FU?DGE?S?BR|FDGESB/)],
  ['Pancake Mix', 'Pantry', re(ab('PANCAKE'), ab('HOTCAKE'), /HCAKE/)],
  ['Cake Mix', 'Pantry', re(ab('CAKE MIX'))],
  ['Gelatin', 'Pantry', /GULAMAN|GELATIN/],
  // Personal care before dairy: COND on a shampoo line is conditioner
  ['Toothbrush', 'Personal Care', re(ab('TOOTHBRUSH'))],
  ['Toothpaste', 'Personal Care', re(ab('TOOTHPASTE'))],
  ['Shampoo', 'Personal Care', re(ab('SHAMPOO'))],
  ['Conditioner', 'Personal Care', re(ab('CONDITIONER'))],
  ['Bath Soap', 'Personal Care', re(ab('BATH SOAP'), ab('BAR SOAP'), /^SOAP|BEAUTYBAR/)],
  ['Body Wash', 'Personal Care', re(ab('BODY WASH'))],
  ['Deodorant', 'Personal Care', re(ab('DEODORANT'), /ROLLON|ANTIPERSP/)],
  ['Alcohol', 'Personal Care', re(ab('ALCOHOL'), /ISOPROPYL/)],
  ['Sanitary Napkins', 'Personal Care', re(ab('NAPKINS'), /SANITARY|PANTYLINER/)],
  ['Cotton Buds', 'Personal Care', re(ab('COTTON BUDS'))],
  ['Lotion', 'Personal Care', /LOTION/],
  // Dairy and eggs
  ['Condensed Milk', 'Dairy & Eggs', re(ab('CONDENSED'), /CONDENSADA|^COND(\d|$|MLK|MILK)/)],
  ['Evaporated Milk', 'Dairy & Eggs', /EVAP/],
  ['Powdered Milk', 'Dairy & Eggs', re(ab('POWDERED MILK'), /MILKPOWDER/)],
  ['Low Fat Milk', 'Dairy & Eggs', re(/^LF(M|MLK|MILK)/, ab('LOW FAT'))],
  ['Non-Fat Milk', 'Dairy & Eggs', re(ab('NON FAT'))],
  ['Fresh Milk', 'Dairy & Eggs', re(ab('FRESH MILK'))],
  ['Cheese', 'Dairy & Eggs', re(ab('CHEESE'), /CHZ|^CHS|QUICKMELT|QUEDEBOLA|QUEDOBOLA/)],
  ['Butter', 'Dairy & Eggs', /BUTTER(?!MILK|SCOTCH)/],
  ['Margarine', 'Dairy & Eggs', re(ab('MARGARINE'))],
  ['Yogurt', 'Dairy & Eggs', re(ab('YOGURT'), /YOGHURT/)],
  ['Eggs', 'Dairy & Eggs', /^(BROWN|WHITE|LARGE|MEDIUM|MED|SMALL|XL|JUMBO)?EGGS?(\d|TRAY|DOZ|$)/],
  ['Ice Cream', 'Frozen', re(ab('ICE CREAM'))],
  // Bread
  ['Wheat Bread', 'Bakery', re(ab('WHEAT BREAD'), /WBREAD|WHTBRD/)],
  ['Bread', 'Bakery', /BREAD|LOAF|PANDESAL/],
  // Meat
  ['Hotdog', 'Meat & Seafood', re(ab('HOTDOG'), /TJHD|TENDERJUICY/)],
  ['Tocino', 'Meat & Seafood', re(ab('TOCINO'))],
  ['Longganisa', 'Meat & Seafood', re(ab('LONGGANISA'))],
  ['Chicken Nuggets', 'Meat & Seafood', /NUGGETS?/],
  ['Embutido', 'Meat & Seafood', /EMBUTIDO/],
  ['Siomai', 'Meat & Seafood', /SIOMAI/],
  // Drinks
  ['3-in-1 Coffee', 'Drinks', /3IN1/],
  ['Coffee', 'Drinks', re(ab('COFFEE'), /KAPE/)],
  ['Powdered Juice', 'Drinks', re(ab('POWDERED JUICE'), /JUICEPOWDER/)],
  ['Juice', 'Drinks', re(ab('JUICE'))],
  ['Iced Tea', 'Drinks', /ICEDTEA/],
  ['Water', 'Drinks', /WATER(?!MELON|CRESS|SPINACH)|DISTILLED/],
  ['Soft Drink', 'Drinks', /SOFTDRINK|SODA/],
  ['Beer', 'Drinks', /BEER|REDHORSE|PALEPILSEN/],
  // Household
  ['Bleach', 'Household', re(ab('BLEACH'))],
  ['Dishwashing Liquid', 'Household', re(ab('DISHWASH'))],
  ['Laundry Detergent', 'Household', re(ab('DETERGENT'), /LAUNDRY/)],
  ['Fabric Conditioner', 'Household', re(ab('FABCON'), ab('FABRIC COND'))],
  ['Trash Bags', 'Household', re(ab('TRASH BAG'), ab('GARBAGE BAG'))],
  ['Zip Bags', 'Household', /^ZS?BAG|ZIPLO?C|ZIPBAG/],
  ['Sponge', 'Household', /SPO?NGE(?!CAKE)/],
  ['Air Freshener', 'Household', re(ab('AIR FRESH'))],
  ['Toilet Paper', 'Household', re(ab('BATHROOM TISSUE'), /TOILETPAPER|TOILETTISSUE|BATHTISSUE/)],
  ['Tissue', 'Household', re(ab('TISSUE'))],
  ['Plastic Forks', 'Household', /FO?RKS?/],
  ['Plastic Spoons', 'Household', /SPOONS?/],
  ['Cling Wrap', 'Household', re(ab('CLING WRAP'))],
  ['Aluminum Foil', 'Household', /FOIL/],
  ['Insect Spray', 'Household', /INSECT|MOSQUITO|KATOL/],
  // Baby
  ['Diapers', 'Baby', /DIAPERS?|DPRS/],
  ['Baby Wipes', 'Baby', /WIPES/],
].map(([name, cat, rx, branded = false]) => ({ name, cat, re: rx, branded }));

// Word-by-word fallback for lines no pattern names.
const WORDS = {
  CHS: 'Cheese', CHSE: 'Cheese', CHZ: 'Cheese', CHCO: 'Choco', CHOC: 'Choco', CHCLT: 'Chocolate',
  MLK: 'Milk', FC: 'Full Cream', LF: 'Low Fat', BNS: 'Beans', PRK: 'Pork', BF: 'Beef', CKN: 'Chicken',
  CHKN: 'Chicken', CHCKN: 'Chicken', SCE: 'Sauce', PST: 'Paste', FLR: 'Flour', SGR: 'Sugar',
  BRWN: 'Brown', WHT: 'White', SLT: 'Salted', VNGR: 'Vinegar', SPCY: 'Spicy', SWT: 'Sweet',
  ORIG: 'Original', ORGNL: 'Original', ASSTD: 'Assorted', ASST: 'Assorted', CRMY: 'Creamy', FRSH: 'Fresh',
  LRG: 'Large', LG: 'Large', MED: 'Medium', SML: 'Small', VAN: 'Vanilla', VNLA: 'Vanilla',
  STRWBRY: 'Strawberry', BNN: 'Banana', MNG: 'Mango', MNGO: 'Mango', ORNG: 'Orange', GRPS: 'Grapes',
  GRP: 'Grape', CRM: 'Cream', BTR: 'Butter', BRD: 'Bread', NDL: 'Noodles', NDLS: 'Noodles',
  MSHRM: 'Mushroom', TMT: 'Tomato', GRLC: 'Garlic', ONN: 'Onion', BCN: 'Bacon', HTDG: 'Hotdog',
  SSG: 'Sausage', PWDR: 'Powder', PWDER: 'Powder', LQD: 'Liquid', DTRGNT: 'Detergent', SHMP: 'Shampoo',
  TSSU: 'Tissue', BLCH: 'Bleach', SPNG: 'Sponge', SPNGE: 'Sponge', TRSH: 'Trash', ALC: 'Alcohol',
  ULTMTE: 'Ultimate', FDGE: 'Fudge', MXD: 'Mixed', FLVR: 'Flavor', SPRD: 'Spread', FRT: 'Fruit',
  JC: 'Juice', JCE: 'Juice', DRK: 'Drink', CF: 'Coffee', CFE: 'Coffee', WTR: 'Water', PNT: 'Peanut',
  CRCKR: 'Crackers', BSCT: 'Biscuit', CKS: 'Cookies', WFR: 'Wafer', CHPS: 'Chips', ADB: 'Adobo',
  FRZN: 'Frozen', HNY: 'Honey', HF: 'High Fiber', CHESSE: 'Cheese', CHSY: 'Cheesy', BBQ: 'BBQ', TRNSPRNT: 'Transparent', CLRSAFE: 'Color Safe',
};
// Packaging and promo words: never part of a shopping-list name.
const NOISE = new Set(['PACK', 'PK', 'PCK', 'PRESPACK', 'POUCH', 'PCH', 'SACHET', 'SCHT', 'BTL', 'BOTTLE',
  'PET', 'CAN', 'DOY', 'DOYPACK', 'REFILL', 'RFL', 'SPOUT', 'JAR', 'BOX', 'TETRA', 'SRP', 'PROMO', 'FREE',
  'BUY', 'TAKE', 'NEW', 'VAT', 'PCS', 'PC', 'EA', 'X']);

// "Hntsprk Bns230g Dp" -> ['HNTSPRK', 'BNS', '230G', 'DP']: letters and digits only,
// split where a word runs into its size.
const tokensOf = (raw) => String(raw || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ')
  .replace(/([A-Z])(?=\d)/g, '$1 ').trim().split(' ').filter(Boolean);

// The tokens left once characters [a, b) of the glued line are cut out. With
// `whole`, a token the cut runs into is dropped, not trimmed: what's left of
// "HCAKEW" after the product took "HCAKE" is noise, not a variant.
function cut(toks, a, b, whole = false) {
  const out = [];
  let pos = 0;
  for (const t of toks) {
    const s = pos;
    pos += t.length;
    const keep = t.slice(0, Math.max(0, Math.min(t.length, a - s))) + t.slice(Math.max(0, Math.min(t.length, b - s)));
    if (keep && (!whole || keep === t)) out.push(keep);
  }
  return out;
}

const cap = (w) => w[0] + w.slice(1).toLowerCase();
// "MLK" in "Milk", "COND" in "Conditioner": a squeezed copy of a word already in the name.
const squeezedIn = (t, head) => head.toUpperCase().split(/[^A-Z]+/)
  .some((w) => w[0] === t[0] && new RegExp(t.split('').join('.*')).test(w));

// Leftover tokens -> words. `head` (the brand + product already named) switches
// on variant mode: only known abbreviations and real-looking words are kept, so
// OCR junk like "PNNYHNG" or a repeat of the product ("MLK") is dropped.
function spell(toks, head = null) {
  let hit = false;
  const words = [];
  for (const t of toks) {
    if (/\d/.test(t) || t.length < 2 || NOISE.has(t) || /^[IOL]?(KGS?|GMS?|ML|LTR?)$/.test(t)) continue;
    const w = WORDS[t] || cap(t);
    if (WORDS[t]) hit = true;
    else if (head !== null && (t.length < 3 || !/[AEIOU]/.test(t))) continue;
    if (head !== null && (squeezedIn(t, head) || head.toLowerCase().includes(w.toLowerCase()))) continue;
    if (!words.includes(w)) words.push(w);
  }
  return { text: words.join(' '), hit };
}

// Pack size from the receipt text: "230G" -> "230g", "1L" -> "1L", "25G X 24S" -> "25g x24".
// Followed by a vowel it is a word, not a unit ("1 LITER" is fine, "5GUMS" is not).
const SIZE_RE = /(\d+(?:[.,]\d+)?)\s*(KGS?|GMS?|GRMS?|G|ML|LTRS?|LT|L|OZ)(?![AEIOU])/g;
function sizeOf(raw) {
  const t = String(raw || '').toUpperCase();
  for (const m of t.matchAll(SIZE_RE)) {
    const n = Number(m[1].replace(',', '.'));
    if (!(n > 0)) continue;
    const unit = { KG: 'kg', KGS: 'kg', ML: 'mL', OZ: 'oz', L: 'L', LT: 'L', LTR: 'L', LTRS: 'L' }[m[2]] || 'g';
    const pack = t.slice(m.index + m[0].length).match(/^\s*X\s*(\d{1,3})S?(?!\d)/);
    return `${n}${unit}${pack && Number(pack[1]) > 1 ? ` x${pack[1]}` : ''}`;
  }
  return '';
}

// Receipt product text -> { name, category } where name is
// "Brand Product Variant Size" (category null when unsure), or null when nothing
// on the line was recognised (the caller keeps its own name).
export function expandName(raw) {
  const toks = tokensOf(raw);
  const glued = toks.join('');
  if (!/[A-Z]{2}/.test(glued)) return null;
  // The brand printed first wins ("DOWNY GARDEN BLOOM" is Downy, not Gardenia).
  let brand = null;
  let at = null;
  for (const b of BRANDS) {
    const m = b.re.exec(glued);
    if (m && (!at || m.index < at.index)) { brand = b; at = m; }
  }
  const rest = at ? cut(toks, at.index, at.index + at[0].length) : toks;
  const after = rest.join('');
  let product = null;
  let variant = rest;
  for (const p of PRODUCTS) {
    if ((p.branded && !brand) || (brand?.cat && brand.cat !== p.cat)) continue;
    const m = p.re.exec(after);
    if (m) {
      product = p;
      variant = cut(rest, m.index, m.index + m[0].length, true);
      break;
    }
  }
  const size = sizeOf(raw);
  const join = (...parts) => parts.filter(Boolean).join(' ');
  if (product) {
    const head = brand && !product.name.includes(brand.name) ? join(brand.name, product.name) : product.name;
    return { name: join(head, spell(variant, head).text, size), category: product.cat };
  }
  if (brand?.product) {
    const head = join(brand.name, brand.product);
    return { name: join(head, spell(rest, head).text, size), category: brand.cat };
  }
  const words = spell(rest);
  if (!brand && !words.hit) return null;
  return { name: join(brand?.name, words.text, size), category: brand?.cat || null };
}

// "Brand Product Size" from separate parts (Open Food Facts, the grocery-photo
// reader), without repeating a brand or size the name already has.
export function fullName(brand, name, size) {
  const n = String(name || '').trim();
  const b = String(brand || '').trim();
  const s = String(size || '').replace(/\s+(?=[a-zA-Z]+$)/, '').trim(); // "500 g" -> "500g"
  const has = (part) => n.toLowerCase().replace(/\s/g, '').includes(part.toLowerCase().replace(/\s/g, ''));
  return [b && !has(b) ? b : '', n, s && !has(s) ? s : ''].filter(Boolean).join(' ');
}

// For the AI readers: the same knowledge as a short instruction.
export const RECEIPT_HINT = `Philippine receipts squeeze names into ~20 characters; expand them to the product a shopper would name, keeping well-known brands. Common codes: PF = Purefoods, DM = Del Monte, WK = White King, LC = Lady's Choice, BF = Best Foods, GAR = Gardenia, DP = Datu Puti, GG = Granny Goose, JNJ = Jack 'n Jill, CB = corned beef, LM after a brand = luncheon meat, PRK BNS = pork & beans, COND = condensed milk, EVAP = evaporated milk, LF / NONFAT = low-fat / non-fat milk, FABCON = fabric conditioner, CHS / CHZ = cheese, SCE = sauce.`;
