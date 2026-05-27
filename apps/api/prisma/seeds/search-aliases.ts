import { PrismaClient } from '@prisma/client';

// Each `term` is the canonical English key stored in DB.
// `aliases` covers: Devanagari, romanised Hindi, Rajasthani variants,
// common misspellings, plural forms, and brand associations.

const ALIASES: Array<{ term: string; aliases: string[] }> = [
  // ── Vegetables (sabzi) ────────────────────────────────────────────────────
  {
    term: 'potato',
    aliases: [
      'aloo', 'alu', 'aaloo', 'aalu', 'आलू', 'आलु', 'potato', 'potatoes',
      'poteto', 'potatoe', 'batata', 'aloo sabzi',
    ],
  },
  {
    term: 'onion',
    aliases: [
      'pyaz', 'pyaaz', 'piaz', 'प्याज', 'प्याजा', 'onion', 'onions',
      'dungri', 'dungli', 'kanda',
    ],
  },
  {
    term: 'tomato',
    aliases: [
      'tamatar', 'tamaatar', 'tomato', 'tomatoes', 'tamoto', 'tamata',
      'टमाटर', 'lal tamatar',
    ],
  },
  {
    term: 'garlic',
    aliases: [
      'lehsun', 'lasan', 'lasun', 'lassan', 'garlic', 'लहसुन', 'lahsun',
      'garlic cloves', 'lehsun ki kali',
    ],
  },
  {
    term: 'ginger',
    aliases: [
      'adrak', 'adrakh', 'अदरक', 'ginger', 'sonth', 'fresh ginger',
      'adrak ka tukda',
    ],
  },
  {
    term: 'green chilli',
    aliases: [
      'hari mirch', 'hari mirchi', 'हरी मिर्च', 'green chilli', 'green chili',
      'chilli', 'mirchi', 'chilly', 'harihari mirch', 'hari mirchen',
    ],
  },
  {
    term: 'cauliflower',
    aliases: [
      'phool gobhi', 'phool gobi', 'फूल गोभी', 'cauliflower', 'gobi',
      'gobhi', 'pholgobhi',
    ],
  },
  {
    term: 'cabbage',
    aliases: [
      'patta gobhi', 'patta gobi', 'पत्ता गोभी', 'cabbage', 'bandh gobhi',
      'bandgobhi', 'pattogobhi',
    ],
  },
  {
    term: 'carrot',
    aliases: [
      'gajar', 'gaajar', 'गाजर', 'carrot', 'carrots', 'carrot sabzi',
      'lal gajar',
    ],
  },
  {
    term: 'peas',
    aliases: [
      'matar', 'mattar', 'मटर', 'peas', 'green peas', 'mutter', 'hara matar',
      'fresh peas', 'matar dana',
    ],
  },
  {
    term: 'spinach',
    aliases: [
      'palak', 'पालक', 'spinach', 'palak saag', 'saag', 'palak bhaji',
    ],
  },
  {
    term: 'fenugreek leaves',
    aliases: [
      'methi', 'methi bhaji', 'मेथी', 'fenugreek', 'fenugreek leaves',
      'methi saag', 'methi patta',
    ],
  },
  {
    term: 'brinjal',
    aliases: [
      'baingan', 'baigan', 'बैंगन', 'brinjal', 'eggplant', 'aubergine',
      'bharta baingan', 'lal baingan', 'began',
    ],
  },
  {
    term: 'bottle gourd',
    aliases: [
      'lauki', 'ghiya', 'doodhi', 'लौकी', 'घिया', 'bottle gourd',
      'lauki gourd', 'doodhiya', 'loki',
    ],
  },
  {
    term: 'bitter gourd',
    aliases: [
      'karela', 'करेला', 'bitter gourd', 'bitter melon', 'karaila',
      'karele', 'kareli',
    ],
  },
  {
    term: 'ridge gourd',
    aliases: [
      'turai', 'torai', 'तोरई', 'ridge gourd', 'luffa', 'toori', 'turiya',
      'tori',
    ],
  },
  {
    term: 'okra',
    aliases: [
      'bhindi', 'भिंडी', 'okra', 'ladyfinger', 'lady finger', 'lady\'s finger',
      'bhenda', 'bhindi sabzi', 'vendai',
    ],
  },
  {
    term: 'radish',
    aliases: [
      'mooli', 'मूली', 'radish', 'white radish', 'muli', 'mooli sabzi',
      'saled mooli',
    ],
  },
  {
    term: 'turnip',
    aliases: [
      'shalgam', 'शलगम', 'turnip', 'shalgum', 'salajam',
    ],
  },
  {
    term: 'pumpkin',
    aliases: [
      'kaddu', 'कद्दू', 'pumpkin', 'petha', 'sitafal', 'kadoo', 'lal kaddu',
      'peela kaddu',
    ],
  },
  {
    term: 'beetroot',
    aliases: [
      'chukandar', 'चुकंदर', 'beetroot', 'beet', 'chukundar', 'chukandhar',
    ],
  },
  {
    term: 'cucumber',
    aliases: [
      'kheera', 'kakdi', 'खीरा', 'cucumber', 'khira', 'kheere', 'kakri',
      'salad kheera',
    ],
  },
  {
    term: 'capsicum',
    aliases: [
      'shimla mirch', 'शिमला मिर्च', 'capsicum', 'bell pepper', 'sweet pepper',
      'shimlamirch', 'green pepper', 'lal shimla mirch', 'peela shimla mirch',
    ],
  },
  {
    term: 'green beans',
    aliases: [
      'sem', 'सेम', 'green beans', 'french beans', 'sem phali', 'beans',
      'kidney bean pods',
    ],
  },
  {
    term: 'cluster beans',
    aliases: [
      'guar phali', 'gawar', 'ग्वार फली', 'cluster beans', 'gavar', 'gawar phali',
      'guar ki phali',
    ],
  },
  {
    term: 'sweet potato',
    aliases: [
      'shakarkand', 'शकरकंद', 'sweet potato', 'sakarkand', 'shakarkandi',
      'meetha aloo', 'shakarkant',
    ],
  },
  {
    term: 'colocasia',
    aliases: [
      'arbi', 'अरबी', 'colocasia', 'taro', 'arvi', 'arbi sabzi', 'ghuiyan',
      'seppankizhangu',
    ],
  },
  {
    term: 'corn',
    aliases: [
      'makka', 'bhutta', 'मक्का', 'भुट्टा', 'corn', 'maize', 'sweet corn',
      'makkai', 'makai', 'cornshelf',
    ],
  },
  {
    term: 'drumstick',
    aliases: [
      'sahjan', 'moringa', 'sahajan', 'सहजन', 'drumstick', 'murungakkai',
      'drumstick pods', 'sahjan ki phali',
    ],
  },
  {
    term: 'coriander leaves',
    aliases: [
      'dhaniya', 'dhania', 'धनिया', 'coriander', 'cilantro', 'hara dhaniya',
      'coriander leaves', 'dhaniye ki patti',
    ],
  },
  {
    term: 'mint',
    aliases: [
      'pudina', 'पुदीना', 'mint', 'peppermint', 'spearmint', 'pudine ki patti',
      'fresh mint',
    ],
  },
  {
    term: 'raw banana',
    aliases: [
      'kacha kela', 'कच्चा केला', 'raw banana', 'green banana', 'plantain',
      'kachcha kela',
    ],
  },
  {
    term: 'mushroom',
    aliases: [
      'khumb', 'खुंभ', 'mushroom', 'mushrooms', 'dhingri', 'button mushroom',
    ],
  },
  {
    term: 'pointed gourd',
    aliases: [
      'parwal', 'परवल', 'pointed gourd', 'parvar', 'potol', 'parbal',
    ],
  },
  {
    term: 'ivy gourd',
    aliases: [
      'tendli', 'kundru', 'कुंदरू', 'ivy gourd', 'tindli', 'tinda',
      'round gourd',
    ],
  },

  // ── Fruits (phal) ─────────────────────────────────────────────────────────
  {
    term: 'mango',
    aliases: [
      'aam', 'आम', 'mango', 'mangoes', 'keri', 'kairee', 'kacha aam',
      'aam ka fal', 'alphonso', 'langra', 'dashehari',
    ],
  },
  {
    term: 'banana',
    aliases: [
      'kela', 'केला', 'banana', 'bananas', 'kele', 'elaichi kela',
      'desi kela', 'nendran',
    ],
  },
  {
    term: 'apple',
    aliases: [
      'seb', 'सेब', 'apple', 'apples', 'sev', 'shimla apple', 'lal seb',
      'hara seb',
    ],
  },
  {
    term: 'orange',
    aliases: [
      'santra', 'संतरा', 'orange', 'oranges', 'narangi', 'kamala', 'santara',
      'kinnu', 'kinnow',
    ],
  },
  {
    term: 'guava',
    aliases: [
      'amrood', 'अमरूद', 'guava', 'guavas', 'amrud', 'peru', 'safed amrood',
    ],
  },
  {
    term: 'grapes',
    aliases: [
      'angur', 'अंगूर', 'grapes', 'grape', 'angoor', 'kismis angur',
      'green grapes', 'black grapes', 'red grapes',
    ],
  },
  {
    term: 'watermelon',
    aliases: [
      'tarbooz', 'तरबूज', 'watermelon', 'tarbuj', 'tarbooj', 'water melon',
      'mathira',
    ],
  },
  {
    term: 'muskmelon',
    aliases: [
      'kharbooja', 'खरबूजा', 'muskmelon', 'melon', 'cantaloupe',
      'kharbuja', 'kharbooza',
    ],
  },
  {
    term: 'papaya',
    aliases: [
      'papita', 'पपीता', 'papaya', 'papayas', 'papite', 'papeeta',
      'lal papita',
    ],
  },
  {
    term: 'pomegranate',
    aliases: [
      'anar', 'अनार', 'pomegranate', 'anaar', 'anardana', 'pomegranates',
    ],
  },
  {
    term: 'pear',
    aliases: [
      'nashpati', 'नाशपाती', 'pear', 'pears', 'nashpata', 'patharnakh',
    ],
  },
  {
    term: 'lemon',
    aliases: [
      'nimbu', 'नींबू', 'lemon', 'lime', 'nimbu pani', 'neembu',
      'shikanji nimbu', 'lemon fruit',
    ],
  },
  {
    term: 'coconut',
    aliases: [
      'nariyal', 'नारियल', 'coconut', 'coconuts', 'nariyal pani',
      'khopra', 'kopra', 'sukha nariyal',
    ],
  },
  {
    term: 'dates',
    aliases: [
      'khajoor', 'खजूर', 'dates', 'date fruit', 'khajur', 'khajoori',
      'medjool',
    ],
  },
  {
    term: 'raisins',
    aliases: [
      'kishmish', 'किशमिश', 'raisins', 'kismis', 'dried grapes',
      'munakka', 'sultana',
    ],
  },
  {
    term: 'plum',
    aliases: [
      'aloo bukhara', 'आलू बुखारा', 'plum', 'plums', 'aloobhukhara',
    ],
  },

  // ── Dairy (dudh ke utpad) ──────────────────────────────────────────────────
  {
    term: 'milk',
    aliases: [
      'doodh', 'dudh', 'दूध', 'milk', 'cow milk', 'buffalo milk', 'toned milk',
      'full cream milk', 'amul doodh', 'mother dairy milk', 'gaay ka doodh',
    ],
  },
  {
    term: 'curd',
    aliases: [
      'dahi', 'दही', 'curd', 'yogurt', 'yoghurt', 'dahee', 'fresh dahi',
      'set curd', 'amul dahi',
    ],
  },
  {
    term: 'buttermilk',
    aliases: [
      'chaas', 'छाछ', 'buttermilk', 'chaach', 'mattha', 'chachh',
      'salted lassi',
    ],
  },
  {
    term: 'ghee',
    aliases: [
      'ghee', 'घी', 'desi ghee', 'clarified butter', 'ghi', 'pure ghee',
      'amul ghee', 'cow ghee', 'buffalo ghee',
    ],
  },
  {
    term: 'butter',
    aliases: [
      'makhan', 'मक्खन', 'butter', 'unsalted butter', 'salted butter',
      'amul butter', 'white butter', 'desi makhan',
    ],
  },
  {
    term: 'paneer',
    aliases: [
      'paneer', 'पनीर', 'cottage cheese', 'fresh paneer', 'amul paneer',
      'chhena', 'chena',
    ],
  },
  {
    term: 'cream',
    aliases: [
      'malai', 'मलाई', 'cream', 'fresh cream', 'amul cream', 'whipping cream',
      'malai cream', 'dairy cream',
    ],
  },
  {
    term: 'khoya',
    aliases: [
      'khoya', 'mawa', 'खोया', 'मावा', 'evaporated milk', 'mava',
      'khoa', 'milk solids',
    ],
  },
  {
    term: 'lassi',
    aliases: [
      'lassi', 'लस्सी', 'sweet lassi', 'mango lassi', 'rose lassi',
      'punjabi lassi',
    ],
  },
  {
    term: 'ice cream',
    aliases: [
      'ice cream', 'icecream', 'kulfi', 'कुल्फी', 'kwality', 'kwality walls',
      'amul ice cream', 'gelato',
    ],
  },
  {
    term: 'cheese',
    aliases: [
      'cheese', 'processed cheese', 'amul cheese', 'cheddar', 'mozzarella',
      'cheese slice', 'cheese cube',
    ],
  },

  // ── Grains & Pulses (anaj aur dal) ────────────────────────────────────────
  {
    term: 'wheat flour',
    aliases: [
      'aata', 'atta', 'आटा', 'wheat flour', 'gehu ka atta', 'chakki atta',
      'whole wheat flour', 'ashirvaad atta', 'aashirvaad', 'pilsbury',
      'gehu aata',
    ],
  },
  {
    term: 'rice',
    aliases: [
      'chawal', 'चावल', 'rice', 'basmati', 'basmati rice', 'sela chawal',
      'chaval', 'raw rice', 'india gate', 'kohinoor rice', 'long grain rice',
    ],
  },
  {
    term: 'maize flour',
    aliases: [
      'makki ka aata', 'मक्की का आटा', 'maize flour', 'corn flour',
      'makki atta', 'makai ka atta', 'makki flour',
    ],
  },
  {
    term: 'gram flour',
    aliases: [
      'besan', 'बेसन', 'gram flour', 'chickpea flour', 'chana ka aata',
      'besan flour',
    ],
  },
  {
    term: 'semolina',
    aliases: [
      'sooji', 'rava', 'सूजी', 'रवा', 'semolina', 'suji', 'bombay rava',
      'fine rava', 'coarse rava', 'rawa',
    ],
  },
  {
    term: 'poha',
    aliases: [
      'poha', 'चिवड़ा', 'chiwda', 'flattened rice', 'beaten rice',
      'chira', 'pohha', 'thin poha', 'thick poha',
    ],
  },
  {
    term: 'chana dal',
    aliases: [
      'chana dal', 'चना दाल', 'split chickpea', 'bengal gram dal',
      'chane ki dal', 'channadal',
    ],
  },
  {
    term: 'masoor dal',
    aliases: [
      'masoor dal', 'मसूर दाल', 'red lentil', 'masur dal', 'red dal',
      'masoor', 'whole masoor', 'masur',
    ],
  },
  {
    term: 'moong dal',
    aliases: [
      'moong dal', 'मूंग दाल', 'green gram dal', 'mung dal', 'yellow moong',
      'split moong', 'dhuli moong', 'whole moong', 'sabut moong',
    ],
  },
  {
    term: 'urad dal',
    aliases: [
      'urad dal', 'उड़द दाल', 'black gram dal', 'dhuli urad', 'white urad',
      'urad', 'udad dal', 'split urad',
    ],
  },
  {
    term: 'kidney beans',
    aliases: [
      'rajma', 'राजमा', 'kidney beans', 'red kidney beans', 'rajmah',
      'rajma chawal',
    ],
  },
  {
    term: 'chickpeas',
    aliases: [
      'chole', 'chana', 'kabuli chana', 'छोले', 'चना', 'chickpeas',
      'garbanzo', 'safed chana', 'white chickpeas', 'chole bhature',
    ],
  },
  {
    term: 'toor dal',
    aliases: [
      'toor dal', 'arhar dal', 'तूर दाल', 'अरहर दाल', 'pigeon pea',
      'tur dal', 'tuvar dal', 'arhar', 'split pigeon pea',
    ],
  },
  {
    term: 'moth beans',
    aliases: [
      'moth dal', 'moth', 'मोठ', 'moth beans', 'mat bean', 'matki',
      'dew bean', 'moth ki daal',
    ],
  },
  {
    term: 'black eyed peas',
    aliases: [
      'lobia', 'लोबिया', 'black eyed peas', 'chawli', 'cowpea', 'lobiya',
      'rongi', 'lobia dal',
    ],
  },
  {
    term: 'oats',
    aliases: [
      'oats', 'जई', 'jaee', 'quaker oats', 'rolled oats', 'instant oats',
      'oat flakes', 'saffola oats',
    ],
  },
  {
    term: 'soybean',
    aliases: [
      'soya', 'soyabean', 'soybean', 'सोया', 'soya chunks', 'nutri nuggets',
      'meal maker', 'soy',
    ],
  },
  {
    term: 'vermicelli',
    aliases: [
      'seviyan', 'सेवइयां', 'vermicelli', 'sewai', 'sevai', 'noodles seviyan',
      'kheer seviyan',
    ],
  },

  // ── Spices (masale) ────────────────────────────────────────────────────────
  {
    term: 'turmeric',
    aliases: [
      'haldi', 'हल्दी', 'turmeric', 'turmeric powder', 'haldi powder',
      'yellow spice', 'golden spice',
    ],
  },
  {
    term: 'red chilli powder',
    aliases: [
      'lal mirch', 'lal mirchi', 'लाल मिर्च', 'red chilli', 'red chili',
      'chilli powder', 'red chilly', 'mirch masala', 'kashmiri lal mirch',
    ],
  },
  {
    term: 'coriander powder',
    aliases: [
      'dhaniya powder', 'dhania powder', 'धनिया पाउडर', 'coriander powder',
      'ground coriander', 'coriander masala',
    ],
  },
  {
    term: 'cumin seeds',
    aliases: [
      'jeera', 'जीरा', 'cumin', 'cumin seeds', 'zeera', 'jira',
      'whole cumin', 'safed jeera',
    ],
  },
  {
    term: 'cumin powder',
    aliases: [
      'jeera powder', 'जीरा पाउडर', 'cumin powder', 'ground cumin',
      'zeera powder',
    ],
  },
  {
    term: 'garam masala',
    aliases: [
      'garam masala', 'गरम मसाला', 'whole spices mix', 'mixed spices',
      'spice blend', 'MDH garam masala', 'everest garam masala',
    ],
  },
  {
    term: 'black pepper',
    aliases: [
      'kali mirch', 'काली मिर्च', 'black pepper', 'pepper', 'pepper powder',
      'kali mirchi', 'whole black pepper', 'peppercorn',
    ],
  },
  {
    term: 'cardamom',
    aliases: [
      'elaichi', 'इलायची', 'cardamom', 'green cardamom', 'small cardamom',
      'ilaichi', 'choti elaichi', 'badi elaichi', 'black cardamom',
    ],
  },
  {
    term: 'cloves',
    aliases: [
      'laung', 'लौंग', 'cloves', 'clove', 'lavang', 'long',
    ],
  },
  {
    term: 'cinnamon',
    aliases: [
      'dalchini', 'दालचीनी', 'cinnamon', 'cinnamon stick', 'dal chini',
      'true cinnamon',
    ],
  },
  {
    term: 'bay leaf',
    aliases: [
      'tej patta', 'तेज पत्ता', 'bay leaf', 'bay leaves', 'tejpatta',
      'indian bay leaf',
    ],
  },
  {
    term: 'mustard seeds',
    aliases: [
      'rai', 'sarson', 'राई', 'सरसों', 'mustard seeds', 'mustard',
      'black mustard', 'yellow mustard', 'rai seeds', 'kadugu',
    ],
  },
  {
    term: 'fenugreek seeds',
    aliases: [
      'methi dana', 'मेथी दाना', 'fenugreek seeds', 'fenugreek',
      'methi seeds', 'methi daana',
    ],
  },
  {
    term: 'asafoetida',
    aliases: [
      'hing', 'हींग', 'asafoetida', 'heeng', 'asafetida', 'hing powder',
      'compounded hing',
    ],
  },
  {
    term: 'salt',
    aliases: [
      'namak', 'नमक', 'salt', 'table salt', 'common salt', 'sendha namak',
      'iodised salt', 'tata salt', 'captain cook',
    ],
  },
  {
    term: 'black salt',
    aliases: [
      'kala namak', 'काला नमक', 'black salt', 'sendha namak', 'sanchal',
      'sulfur salt',
    ],
  },
  {
    term: 'dry mango powder',
    aliases: [
      'amchur', 'अमचूर', 'dry mango powder', 'amchoor', 'raw mango powder',
      'khatai',
    ],
  },
  {
    term: 'chaat masala',
    aliases: [
      'chaat masala', 'चाट मसाला', 'MDH chaat masala', 'everest chaat',
      'chaat spice mix',
    ],
  },
  {
    term: 'carom seeds',
    aliases: [
      'ajwain', 'अजवाइन', 'carom seeds', 'ajwan', 'omam', 'bishop weed',
      'ajowan',
    ],
  },

  // ── Oils & Condiments ─────────────────────────────────────────────────────
  {
    term: 'mustard oil',
    aliases: [
      'sarson ka tel', 'सरसों का तेल', 'mustard oil', 'sarson oil',
      'kachchi ghani', 'patanjali mustard oil', 'fortune mustard oil',
    ],
  },
  {
    term: 'sunflower oil',
    aliases: [
      'sunflower oil', 'sunflower tel', 'सूरजमुखी तेल', 'refined oil',
      'fortune sunflower', 'saffola gold', 'sundrop',
    ],
  },
  {
    term: 'cooking oil',
    aliases: [
      'tel', 'तेल', 'cooking oil', 'vegetable oil', 'refined vegetable oil',
      'vanaspati', 'dalda', 'oil',
    ],
  },
  {
    term: 'pickle',
    aliases: [
      'achaar', 'अचार', 'pickle', 'achar', 'mixed pickle', 'mango pickle',
      'aam ka achaar', 'kisaan pickle', 'mothers recipe pickle',
    ],
  },
  {
    term: 'ketchup',
    aliases: [
      'ketchup', 'tomato sauce', 'टमाटर सॉस', 'catchup', 'tomato ketchup',
      'maggi sauce', 'kissan ketchup', 'heinz ketchup',
    ],
  },
  {
    term: 'vinegar',
    aliases: [
      'sirka', 'सिरका', 'vinegar', 'white vinegar', 'apple cider vinegar',
      'sirka achar',
    ],
  },
  {
    term: 'sugar',
    aliases: [
      'cheeni', 'shakkar', 'चीनी', 'शक्कर', 'sugar', 'white sugar',
      'cane sugar', 'boora', 'bura', 'mishri', 'caster sugar',
    ],
  },
  {
    term: 'jaggery',
    aliases: [
      'gud', 'gur', 'गुड़', 'jaggery', 'palm jaggery', 'cane jaggery',
      'sugarcane jaggery', 'organic jaggery',
    ],
  },

  // ── Household Items (ghar ka saman) ────────────────────────────────────────
  {
    term: 'soap',
    aliases: [
      'sabun', 'साबुन', 'soap', 'bath soap', 'hand wash', 'lux soap',
      'dettol soap', 'lifebuoy', 'dove soap', 'pears soap',
    ],
  },
  {
    term: 'detergent powder',
    aliases: [
      'kapde dhone ka powder', 'कपड़े धोने का पाउडर', 'detergent',
      'washing powder', 'surf excel', 'ariel', 'tide', 'nirma', 'rin',
      'kapde ka soap', 'washing soap',
    ],
  },
  {
    term: 'dish wash soap',
    aliases: [
      'bartan soap', 'bartan manjna', 'बर्तन साफ करना', 'dish wash',
      'vim', 'exo', 'pril', 'dish washing liquid', 'utensil cleaner',
      'bartan dhone ka soap',
    ],
  },
  {
    term: 'broom',
    aliases: [
      'jhadu', 'झाड़ू', 'broom', 'jhaaru', 'floor broom', 'phool jhadu',
    ],
  },
  {
    term: 'matchbox',
    aliases: [
      'maachis', 'माचिस', 'matchbox', 'match box', 'diyasalai',
      'matches', 'lighter',
    ],
  },
  {
    term: 'candle',
    aliases: [
      'mombatti', 'मोमबत्ती', 'candle', 'mombati', 'wax candle',
      'candles',
    ],
  },
  {
    term: 'plastic bags',
    aliases: [
      'polythene', 'पॉलिथीन', 'plastic bags', 'carry bags', 'covers',
      'plastic cover', 'poly bag', 'shopping bag',
    ],
  },
  {
    term: 'tissue paper',
    aliases: [
      'tissue', 'टिश्यू', 'tissue paper', 'napkins', 'facial tissue',
      'kleenex', 'toilet paper', 'tissue roll',
    ],
  },
  {
    term: 'batteries',
    aliases: [
      'battery', 'बैटरी', 'batteries', 'AA battery', 'AAA battery',
      'cell', 'dry cell', 'eveready', 'duracell',
    ],
  },
  {
    term: 'floor cleaner',
    aliases: [
      'phenyl', 'फिनाइल', 'floor cleaner', 'lizol', 'lizol cleaner',
      'domex', 'harpic floor', 'floor wash', 'neel',
    ],
  },
  {
    term: 'mop',
    aliases: [
      'pochha', 'पोंछा', 'mop', 'floor mop', 'spin mop', 'pocha',
      'pochhe wala kapda',
    ],
  },
  {
    term: 'garbage bags',
    aliases: [
      'dustbin bags', 'garbage bag', 'कचरा बैग', 'trash bags', 'bin liner',
      'waste bags',
    ],
  },
  {
    term: 'mosquito coil',
    aliases: [
      'coil', 'mosquito coil', 'good knight coil', 'mortein coil',
      'मच्छर कॉइल', 'macchar coil', 'agarbatti coil',
    ],
  },
  {
    term: 'mosquito repellent',
    aliases: [
      'all out', 'hit', 'mosquito repellent', 'मच्छर भगाने वाला',
      'macchar bhagane wala', 'liquid repellent', 'good knight',
      'mortein spray', 'fast card',
    ],
  },
  {
    term: 'room freshener',
    aliases: [
      'air freshener', 'room spray', 'एयर फ्रेशनर', 'odonil', 'ambi pur',
      'glade', 'room freshener spray', 'car freshener',
    ],
  },
  {
    term: 'light bulb',
    aliases: [
      'bulb', 'बल्ब', 'light bulb', 'LED bulb', 'tubelight', 'CFL bulb',
      'philips bulb', 'syska', 'havells',
    ],
  },

  // ── Personal Care ─────────────────────────────────────────────────────────
  {
    term: 'shampoo',
    aliases: [
      'shampoo', 'शैंपू', 'hair wash', 'baal dhone ka', 'head and shoulders',
      'clinic plus', 'pantene', 'dove shampoo', 'sunsilk', 'patanjali kesh',
    ],
  },
  {
    term: 'toothpaste',
    aliases: [
      'toothpaste', 'टूथपेस्ट', 'dant manjan', 'toothpaste tube', 'colgate',
      'pepsodent', 'close up', 'sensodyne', 'patanjali dant kanti',
      'oral b', 'manjan',
    ],
  },
  {
    term: 'toothbrush',
    aliases: [
      'toothbrush', 'टूथब्रश', 'brush', 'oral b brush', 'colgate brush',
      'dant brush', 'tooth brush',
    ],
  },
  {
    term: 'hair oil',
    aliases: [
      'baal ka tel', 'बालों का तेल', 'hair oil', 'champi tel', 'coconut hair oil',
      'parachute', 'dabur amla', 'vatika', 'bajaj almond drops', 'kesh king',
      'brig champi',
    ],
  },
  {
    term: 'face wash',
    aliases: [
      'face wash', 'फेस वॉश', 'face cleanser', 'muh dhone ka', 'garnier face wash',
      'himalaya face wash', 'ponds face wash', 'clean and clear',
    ],
  },
  {
    term: 'antiseptic',
    aliases: [
      'dettol', 'डेटॉल', 'antiseptic', 'savlon', 'antiseptic liquid',
      'antiseptic lotion', 'wound cleaner',
    ],
  },
  {
    term: 'sanitary pads',
    aliases: [
      'sanitary pad', 'पैड', 'pad', 'mahwari pad', 'whisper', 'stayfree',
      'sofy', 'sanitary napkin', 'period pad',
    ],
  },
  {
    term: 'cotton',
    aliases: [
      'rooi', 'रूई', 'cotton', 'cotton balls', 'cotton pads', 'absorbent cotton',
      'johnson cotton',
    ],
  },
  {
    term: 'razor',
    aliases: [
      'blade', 'razor', 'shaver', 'ब्लेड', 'shaving blade', 'gillette',
      'gillette mach3', '7 o clock blade', 'wilkinson sword',
    ],
  },
  {
    term: 'shaving cream',
    aliases: [
      'shaving cream', 'शेविंग क्रीम', 'shaving gel', 'palmolive shaving',
      'gillette foam', 'old spice', 'VI-John',
    ],
  },
  {
    term: 'talcum powder',
    aliases: [
      'talcum powder', 'पाउडर', 'powder', 'baby powder', 'johnson baby powder',
      'prickly heat powder', 'boroplus powder', 'bath powder',
    ],
  },

  // ── Beverages (peene ki cheezein) ─────────────────────────────────────────
  {
    term: 'tea',
    aliases: [
      'chai', 'chay', 'चाय', 'tea', 'tea leaves', 'tea powder', 'brooke bond',
      'lipton', 'tata tea', 'red label', 'taj mahal tea', 'green tea',
      'masala chai',
    ],
  },
  {
    term: 'coffee',
    aliases: [
      'coffee', 'कॉफी', 'instant coffee', 'nescafe', 'bru coffee',
      'filter coffee', 'espresso', 'cold coffee',
    ],
  },
  {
    term: 'drinking water',
    aliases: [
      'paani', 'पानी', 'drinking water', 'mineral water', 'bisleri',
      'kinley', 'aquafina', 'packaged water', 'water bottle',
    ],
  },
  {
    term: 'cold drink',
    aliases: [
      'cold drink', 'ठंडा', 'thanda', 'soft drink', 'soda', 'pepsi',
      'coca cola', 'coke', 'sprite', 'limca', 'fanta', 'thumbs up',
      'maaza', 'cold drinks', 'fizzy drink',
    ],
  },
  {
    term: 'fruit juice',
    aliases: [
      'juice', 'जूस', 'fruit juice', 'real juice', 'tropicana',
      'raw pressery', 'mango juice', 'orange juice', 'mixed fruit juice',
    ],
  },
  {
    term: 'energy drink',
    aliases: [
      'glucose', 'glucon-d', 'glucond', 'ग्लूकोज', 'energy drink',
      'electral', 'glucose powder', 'instant energy', 'glucon d',
    ],
  },
  {
    term: 'health drink',
    aliases: [
      'horlicks', 'bournvita', 'complan', 'boost', 'हॉर्लिक्स', 'malt drink',
      'health supplement drink', 'ovaltine', 'pediasure',
    ],
  },
  {
    term: 'coconut water',
    aliases: [
      'nariyal paani', 'नारियल पानी', 'coconut water', 'tender coconut',
      'nariyal pani', 'dabba nariyal', 'packaged coconut water',
    ],
  },
  {
    term: 'soda water',
    aliases: [
      'soda', 'सोडा', 'soda water', 'club soda', 'bisleri soda',
      'kinley soda', 'sprite zero', 'limca soda',
    ],
  },
  {
    term: 'milk powder',
    aliases: [
      'doodh powder', 'दूध पाउडर', 'milk powder', 'amul milk powder',
      'everyday milk powder', 'skimmed milk powder', 'dairy whitener',
    ],
  },

  // ── Snacks (nashta) ───────────────────────────────────────────────────────
  {
    term: 'biscuits',
    aliases: [
      'biscuit', 'बिस्किट', 'cookies', 'parle g', 'parle-g', 'good day',
      'marie biscuit', 'britannia', 'hide and seek', 'bourbon', 'digestive',
      'krackjack', 'monaco',
    ],
  },
  {
    term: 'namkeen',
    aliases: [
      'namkeen', 'नमकीन', 'savory snacks', 'mixture', 'haldiram namkeen',
      'bhujia', 'chana chur', 'farsan', 'sev', 'murmura mix',
    ],
  },
  {
    term: 'chips',
    aliases: [
      'chips', 'चिप्स', 'wafers', 'crisps', 'potato chips', 'lays',
      'uncle chips', 'bingo', 'kurkure', 'pringles',
    ],
  },
  {
    term: 'papad',
    aliases: [
      'papad', 'पापड़', 'poppadum', 'appalam', 'lijjat papad',
      'masala papad', 'urad papad',
    ],
  },
  {
    term: 'bread',
    aliases: [
      'bread', 'ब्रेड', 'double roti', 'sandwich bread', 'modern bread',
      'britannia bread', 'english muffin', 'toast bread', 'brown bread',
      'whole wheat bread',
    ],
  },
  {
    term: 'rusk',
    aliases: [
      'rusk', 'रस्क', 'toast', 'britannia rusk', 'eggless rusk',
      'milk rusk',
    ],
  },
  {
    term: 'noodles',
    aliases: [
      'maggi', 'नूडल्स', 'noodles', 'instant noodles', 'maggi noodles',
      'top ramen', 'yippee noodles', 'wai wai',
    ],
  },
  {
    term: 'peanuts',
    aliases: [
      'moongfali', 'मूंगफली', 'peanuts', 'groundnut', 'groundnuts',
      'mungfali', 'salted peanuts', 'roasted peanuts', 'phalli',
    ],
  },
  {
    term: 'cashews',
    aliases: [
      'kaju', 'काजू', 'cashews', 'cashew nuts', 'whole cashew', 'broken kaju',
    ],
  },
  {
    term: 'almonds',
    aliases: [
      'badam', 'बादाम', 'almonds', 'mamra badam', 'california almonds',
      'badaam',
    ],
  },
  {
    term: 'walnuts',
    aliases: [
      'akhrot', 'अखरोट', 'walnuts', 'walnut', 'kashmiri akhrot',
    ],
  },
  {
    term: 'murmura',
    aliases: [
      'murmura', 'मुरमुरा', 'puffed rice', 'mamra', 'popcorn rice',
      'bhel puri', 'churmura',
    ],
  },
  {
    term: 'popcorn',
    aliases: [
      'popcorn', 'पॉपकॉर्न', 'makki popcorn', 'microwave popcorn',
      'pop corn', 'butter popcorn', 'caramel popcorn',
    ],
  },
  {
    term: 'sev',
    aliases: [
      'sev', 'सेव', 'fried sev', 'bhujia sev', 'aloo sev', 'thin sev',
      'garlic sev', 'ratlami sev',
    ],
  },

  // ── Medicine & Health (dawa aur sehat) ────────────────────────────────────
  {
    term: 'paracetamol',
    aliases: [
      'paracetamol', 'पैरासिटामोल', 'crocin', 'dolo', 'dolo 650', 'fever tablet',
      'bukhaar ki dawa', 'calpol', 'metacin',
    ],
  },
  {
    term: 'bandage',
    aliases: [
      'bandage', 'पट्टी', 'patti', 'wound dressing', 'crepe bandage',
      'bandaid', 'band aid', 'elastoplast',
    ],
  },
  {
    term: 'balm',
    aliases: [
      'vicks', 'balm', 'iodex', 'बाम', 'tiger balm', 'pain balm',
      'moov cream', 'volini', 'zandu balm', 'pain relief', 'vaporub',
    ],
  },
  {
    term: 'antacid',
    aliases: [
      'eno', 'antacid', 'gaviscon', 'digene', 'डाइजीन', 'pet dard ki dawa',
      'gelusil', 'acidity tablet', 'pepto bismol', 'ranitidine',
    ],
  },
  {
    term: 'ors',
    aliases: [
      'ors', 'ओआरएस', 'electral', 'jeevanjal', 'oral rehydration', 'electrolyte',
      'dast ki dawa', 'dehydration salt',
    ],
  },
  {
    term: 'vitamins',
    aliases: [
      'vitamin', 'विटामिन', 'multivitamin', 'vitamin c', 'vitamin d',
      'limcee', 'celin', 'supradyn', 'one a day',
    ],
  },
  {
    term: 'eye drops',
    aliases: [
      'eye drops', 'आंख की दवा', 'aankh ki dawa', 'otrivin', 'refresh tears',
      'itone', 'eye care drops', 'redness eye drops',
    ],
  },
  {
    term: 'antiseptic cream',
    aliases: [
      'antiseptic cream', 'boroline', 'dettol cream', 'soframycin', 'neosporin',
      'wound cream', 'betadine', 'घाव की क्रीम',
    ],
  },
];

export async function seedSearchAliases(prisma: PrismaClient): Promise<void> {
  let count = 0;

  for (const entry of ALIASES) {
    await prisma.searchAlias.upsert({
      where:  { term: entry.term },
      update: { aliases: entry.aliases },
      create: { term: entry.term, aliases: entry.aliases },
    });
    count++;
  }

  console.log(`  ✅ Search aliases seeded (${count} canonical terms)`);
}
