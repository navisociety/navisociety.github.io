// ═══════════════════════════════════════════════════════════════════════════
// NAVI Model — v10
// Built by NAVIsociety, shaped by Prophet Dian.
// v10: Emotion (13 nodes — what emotions are, regulation, anger, grief, joy,
//      shame/guilt, numbness, jealousy, fear, somatic storage, emotional
//      contagion, emotion & decision-making), Human Order Systems (11 nodes —
//      social order, hierarchy, institutions, power, law vs justice, economic
//      systems, democracy, class, bureaucracy, tradition, colonialism's legacy),
//      Connection (10 nodes — biological need, loneliness crisis, alone vs
//      lonely, building real connection, shallow vs deep, trust, conflict &
//      connection, digital vs physical, belonging, community). 34 new nodes,
//      ~277 total.
// v9: RAG (Retrieval-Augmented Generation) — replaces single-node retrieval
//     with top-K multi-node retrieval (retrieveTopK), adds semantic response
//     variant selection (selectBestVariant) so each reply is the response
//     most aligned with the exact query, and introduces cross-domain
//     augmentation: when a second knowledge node is strongly relevant NAVI
//     surfaces the most contextually matched line from it as added context.
// v8: a new domain of logic & reason (deductive, inductive, abductive
//     reasoning, fallacies, argument structure, cognitive bias, first
//     principles, Socratic method, scientific method, probability, systems
//     thinking), deeper human nature (narrative, tribalism, status,
//     reciprocity, scarcity vs abundance, autonomy, envy, uncertainty,
//     bystander effect, mirror neurons), and English mastery (academic
//     writing, rhetoric, literary devices, creative writing, oratory, debate,
//     critical reading, register, workplace English, vocabulary) — built on
//     the v7 foundation below.
// v7: a deep expansion into advanced English language (phrasal verbs,
//     conditionals, transitions, professional writing, public speaking,
//     punctuation, difficult conversations) and deep human nature &
//     psychology (attachment, emotional intelligence, cognitive bias,
//     motivation, self-sabotage, trauma, grief, addiction, meaning, growth) —
//     built on the v6 foundation of world knowledge, science, history,
//     intermediate English, and the v5 base of English + human psychology.
//     All responses in clear standard English.
// ═══════════════════════════════════════════════════════════════════════════

export type NaviMessage = { role: 'user' | 'assistant'; content: string };

// ── Math primitives ──────────────────────────────────────────────────────────

function dot(a: number[], b: number[]): number {
  let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s;
}
function cosine(a: number[], b: number[]): number {
  const ab = dot(a, b); let na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { na += a[i]*a[i]; nb += b[i]*b[i]; }
  return na && nb ? ab / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
function softmax(x: number[]): number[] {
  const mx = Math.max(...x); const e = x.map(v => Math.exp(v - mx));
  const s = e.reduce((a, b) => a + b, 0); return e.map(v => v / s);
}
function gelu(x: number): number {
  return 0.5 * x * (1 + Math.tanh(Math.sqrt(2/Math.PI) * (x + 0.044715*x*x*x)));
}
function layerNorm(x: number[], eps = 1e-6): number[] {
  const mean = x.reduce((a, b) => a + b, 0) / x.length;
  const std = Math.sqrt(x.reduce((a, b) => a + (b-mean)**2, 0) / x.length + eps);
  return x.map(v => (v - mean) / std);
}
function matVec(M: number[][], v: number[]): number[] { return M.map(row => dot(row, v)); }

const DIM = 64, N_HEADS = 4, FF_DIM = 256, MAX_SEQ = 128;

// ── Tokenizer ────────────────────────────────────────────────────────────────

class NaviTokenizer {
  private vocab: Map<string, number>;
  readonly vocabSize: number;
  readonly BOS = 1; readonly EOS = 2; readonly UNK = 3;

  constructor() {
    const words = [
      '<pad>','<bos>','<eos>','<unk>',
      'navi','navisociety','prophet','dian','llm','model','ai','intelligence','free','forever',
      'built','created','made','designed','new','own','thing','myself',
      'hello','hi','hey','yo','sup','greetings','good','morning','evening','night','afternoon',
      'how','are','you','what','who','why','when','where','which','whose',
      'is','was','were','be','been','being','am',
      'can','could','would','should','will','shall','may','might','must','do','does','did',
      'have','has','had','get','got','gotten',
      'i','me','my','mine','we','our','ours','it','its','this','that','these','those',
      'he','she','they','them','their','your','yours',
      'a','an','the','and','or','but','if','then','so','because','since','although','though',
      'in','on','at','to','for','with','by','from','of','about','like','as','than',
      'up','down','out','into','through','over','under','between','around','along','off',
      'not','no','yes','yeah','yep','ok','sure','right','true','false','maybe','just',
      'very','really','quite','too','also','even','only','still','already','yet','now',
      'all','some','any','many','much','most','few','little','other','same','such','both',
      'think','know','feel','see','say','tell','ask','want','need','keep',
      'go','come','make','take','give','find','help','work','try','start','stop',
      'look','seem','show','play','hear','listen','watch','read','write','speak',
      'great','nice','cool','amazing','awesome','interesting','beautiful','powerful',
      'hard','easy','important','different','real','big','small','long','short',
      'love','enjoy','appreciate','understand','believe','hope','trust',
      'music','song','beat','sound','audio','track','album','artist','producer','rap',
      'art','design','visual','color','style','creative','create','express','beauty',
      'tech','technology','code','software','data','system','build','develop','program',
      'life','people','world','society','culture','community','human','person','body','mind',
      'time','future','past','today','tomorrow','change','grow','learn','evolve',
      'soul','spirit','purpose','meaning','truth','power','energy','light',
      'money','business','success','career','goal','dream','vision','mission','brand',
      'friend','family','relationship','connect','share','together','alone','lonely',
      'idea','thought','question','answer','problem','solution','plan','strategy',
      'happy','sad','angry','scared','excited','calm','lost','found','confused',
      'something','anything','everything','nothing','someone','everyone','anyone',
      'name','place','story','word','language','voice','message','conversation','chat',
      'rekkies','glory','grace','corp','records','club','media','movement','platform',
      'open','access','inspire',
      'lyrics','flow','bars','verse','chorus','hook','melody','harmony','rhythm',
      'god','faith','prayer','divine','spiritual','higher','calling','gift',
      'consciousness','aware','presence','moment','breath','peace','joy','pain','healing',
      'generation','young','old','age','youth','wisdom','experience','teach',
      'africa','south','global','universal','local','roots','heritage',
      'fail','failure','mistake','stuck','motivate','inspire','discipline','consistent',
      'book','books','learning','skill','improve','knowledge','education','study',
      'hurt','trauma','struggling','depression','anxiety','mental','health',
      // expanded vocab
      'startup','entrepreneur','founder','company','launch','product','market','customer',
      'audience','content','creator','influence','followers','viral','post','brand','grow',
      'leader','leadership','team','manage','collaborate','partnership','delegate','hire',
      'philosophy','consciousness','existence','meaning','free','will','choice','determinism',
      'history','legacy','remember','remembered','impact','footprint','generations',
      'authenticity','authentic','genuine','honest','integrity','character','values',
      'excellence','excellent','quality','craft','mastery','standard','best',
      'gratitude','grateful','thankful','mindful','mindfulness','present','aware','now',
      'forgive','forgiveness','conflict','resolve','letgo','move','past','closure',
      'ubuntu','loadshedding','eskom','braai','township','kasi','lekker','sharp','bru',
      'compliment','encourage','affirm','proud','capable','strong','enough','worthy',
      'habit','routine','focus','distraction','procrastinate','productivity','deepwork',
      'fear','courage','brave','risk','bold','comfort','zone','uncertainty',
      'patience','time','process','journey','step','slow','steady','compound',
      'identity','self','authentic','become','growth','transform','reinvent',
      'doubt','imposter','confidence','believe','capable','validation','external',
      'rest','burnout','tired','exhausted','recover','recharge','balance','boundaries',
      'fitness','exercise','gym','health','sleep','nutrition','strong','discipline',
      'writing','poetry','words','story','narrative','express','communicate','articulate',
      'dance','perform','stage','crowd','energy','presence','charisma',
      'fashion','drip','aesthetic','vibe','aura','presence','clean',
      'business','revenue','profit','scale','growth','customer','value','solve','problem',
      'invest','investment','save','spend','wealth','assets','passive','income',
      'network','connections','relationships','reputation','opportunity','luck','prepared',
      // basic english
      'grammar','sentence','verb','noun','adjective','tense','vocabulary','definition','translate',
      'sorry','excuse','please','welcome','goodbye','bye','thank','apologize','polite',
      'agree','disagree','opinion','correct','wrong','understand','explain','means','mean',
      'count','number','first','second','third','fourth','fifth','days','week','month','year',
      'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
      'january','february','march','april','june','july','august','september','october','november','december',
      'morning','afternoon','evening','clock','hour','minute','date','today','yesterday','tomorrow',
      'describe','communicate','language','phrase','expression','accent','speak','fluent',
      // human nature
      'emotion','emotions','feeling','instinct','behavior','behaviour','psychology','nature',
      'brain','memory','habit','survival','belonging','attachment','grief','shame','guilt',
      'pride','compassion','empathy','morality','conscience','moral','death','die','dying',
      'curious','wonder','curiosity','communicate','narrative','storytelling','stories',
      'mistake','choice','character','evil','childhood','development','upbringing',
      'anger','rage','fear','joy','sadness','disgust','surprise','basic','needs',
      'maslow','hierarchy','safety','shelter','hunger','thirst','warmth','love',
      'social','instincts','reaction','pattern','evolution','evolved','survival','primal',
      'honest','honesty','deceive','deception','lie','lies','truth','trust','trustworthy',
      'compare','comparison','compete','competition','jealousy','envy','admire',
      'grief','mourning','loss','death','cope','accept','process',
      'born','grow','old','child','adult','baby','teenager','mature',
      // v6: world knowledge
      'planet','earth','sun','moon','star','space','universe','galaxy','ocean','sea','river',
      'mountain','forest','desert','island','continent','country','city','nation','border',
      'animal','plant','tree','flower','bird','fish','insect','mammal','reptile',
      'science','biology','chemistry','physics','math','mathematics','equation','theory','experiment',
      'history','century','ancient','modern','war','peace','revolution','empire','civilization',
      'art','painting','sculpture','photography','film','movie','theatre','drama','comedy',
      'sport','sports','football','basketball','cricket','tennis','athletics','team','player','game','win','lose',
      'food','cook','cooking','recipe','ingredient','meal','breakfast','lunch','dinner','taste','flavor',
      'travel','journey','destination','culture','tradition','language','religion','belief','church','mosque','temple',
      'weather','rain','sun','cloud','storm','wind','temperature','season','spring','summer','autumn','winter',
      'health','medicine','doctor','hospital','disease','illness','treatment','heal','body','organ','blood',
      'government','law','rights','freedom','democracy','justice','equality','vote','politics','power',
      'economy','trade','market','price','inflation','unemployment','poverty','wealth','development',
      'environment','nature','pollution','climate','energy','water','air','soil','recycling','sustainable',
      // v6: intermediate english
      'idiom','expression','phrase','proverb','metaphor','simile','analogy','context','meaning','imply',
      'formal','informal','casual','professional','academic','written','spoken','verbal','nonverbal',
      'active','passive','voice','clause','subject','object','predicate','sentence','paragraph',
      'prefix','suffix','root','syllable','vowel','consonant','pronunciation','spell','spelling',
      'essay','report','letter','email','text','message','document','draft','edit','revise',
      // advanced english
      'phrasal','conditional','clause','tense','passive','active','subjunctive','participle',
      'however','therefore','moreover','furthermore','although','despite','nevertheless','whereas',
      'punctuation','comma','apostrophe','semicolon','colon','hyphen','quotation','bracket',
      'transition','connective','coherent','concise','precise','articulate','fluent','accent',
      'presentation','speech','audience','persuade','argue','debate','negotiate','interview',
      'paraphrase','summarize','elaborate','clarify','rephrase','emphasis','tone','register',
      // psychology depth
      'attachment','secure','anxious','avoidant','bonding','caregiver','childhood','wound',
      'emotional','intelligence','empathy','self-awareness','regulation','resilience','trigger',
      'bias','cognitive','confirmation','sunk','heuristic','rational','irrational','unconscious',
      'motivation','intrinsic','extrinsic','reward','drive','ambition','willpower','discipline',
      'trauma','ptsd','wound','healing','therapy','therapist','counselling','support',
      'sabotage','critic','inner','voice','negative','self-talk','affirmation','reframe',
      'addiction','dependency','craving','withdrawal','recovery','relapse','habit','loop',
      'conformity','pressure','peer','social','norm','rebel','authority','obedience','groupthink',
      'grief','stages','denial','bargaining','depression','acceptance','mourning','loss','cope',
      'confidence','esteem','worth','value','capable','prove','validate','approval','rejection',
      'procrastinate','delay','avoidance','overwhelm','perfectionism','done','progress','start',
      'forgive','resentment','grudge','release','peace','closure','move','forward',
      'vulnerable','vulnerability','open','guard','wall','trust','risk','seen','known',
      'meaning','purpose','logotherapy','frankl','existential','void','fulfillment','legacy',
      'change','transform','uncomfortable','growth','discomfort','new','pattern','rewire',
      // v8: logic & reason
      'logic','logical','reasoning','reason','fallacy','fallacies','argument','premise','conclusion',
      'deductive','inductive','abductive','syllogism','valid','sound','inference','critical','thinking',
      'bias','cognitive','confirmation','anchoring','heuristic','availability','assumption',
      'principles','socratic','hypothesis','scientific','method','probability','odds','baserate',
      'systems','feedback','emergent','consequences','fact','facts','opinion','belief','beliefs',
      'deduce','induce','probable','certain','rational','evidence','prove','disprove','test',
      // v8: human nature depth
      'narrative','tribal','tribe','ingroup','outgroup','status','hierarchy','rank',
      'reciprocity','debt','favour','favor','scarcity','abundance','autonomy','agency',
      'envy','comparison','uncertainty','bystander','diffusion','responsibility','mirror','neurons','contagion',
      // v8: english mastery
      'academic','thesis','citation','rhetoric','ethos','pathos','logos','persuade','persuasion',
      'metaphor','simile','irony','foreshadowing','symbolism','figurative','device','devices',
      'creative','character','conflict','voice','oratory','speaking','pace','pause','emphasis',
      'debate','rebuttal','register','tone','subtext','vocabulary','etymology','origin','precise','audience',
      // v10: emotion
      'somatic','regulate','emotional','contagion','numbness','numb','heartbreak','grief','shame',
      'guilt','envy','jealous','jealousy','rage','overwhelmed','anxious','anxiety','regulate','regulation',
      'damasio','marker','body','stored','suppressed','suppression','catharsis','release','bottled',
      // v10: human order systems
      'hierarchy','institution','institutions','bureaucracy','colonialism','colonial','capitalism',
      'socialism','democracy','reform','revolution','class','mobility','oppression','civic','solidarity',
      'authority','obedience','compliance','legitimacy','governance','ruling','elite','ordinary',
      'inequality','systemic','structure','structural','policy','policies','citizen','citizens',
      // v10: connection
      'isolation','belonging','vulnerability','presence','genuine','shallow','loneliness','community',
      'bond','bonds','intimacy','closeness','seen','known','heard','understood','accepted','excluded',
      'digital','online','offline','screen','real','physical','in-person','meetup',
      // v11: relationships, family, finance, leadership, climate, tech, coding, philosophy, african history, sports psychology
      'compound','compounding','interest','debt','loan','loans','savings','budget','budgeting','invest','investment','investing','stokvel','abundance','dividend','assets',
      'delegate','delegation','accountability','servant','micromanage','mentor','feedback','culture',
      'climate','warming','carbon','emissions','sustainability','sustainable','renewable','solar','scarcity','loadshedding','grid','greenhouse',
      'automation','automate','reskill','upskill','blockchain','crypto','cryptocurrency','bitcoin','metaverse','decentralised','ledger','web3',
      'coding','debug','debugging','programmer','programming','algorithm','engineer',
      'stoicism','stoic','existentialism','existential','absurdism','determinism','ethics','morality','aurelius','camus','sartre',
      'colonisation','colonialism','colonial','apartheid','decolonise','decolonisation','precolonial','liberation','independence','reclaim','timbuktu','zimbabwe',
      'visualisation','visualise','champion','comeback','choke','defeat','breakup','dating','situationship','unconditional','generational','parenting',
    ];
    this.vocab = new Map(words.map((w, i) => [w, i]));
    this.vocabSize = words.length;
  }

  encode(text: string): number[] {
    const tokens = text.toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, ' ')
      .split(/\s+/).filter(Boolean)
      .map(w => this.vocab.get(w) ?? this.UNK);
    return [this.BOS, ...tokens.slice(0, MAX_SEQ - 2), this.EOS];
  }
}

// ── Embedder ─────────────────────────────────────────────────────────────────

class NaviEmbedder {
  private tokEmb: number[][];
  private posEmb: number[][];

  constructor(vocabSize: number) {
    const seed = (n: number) => {
      const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
      return (x - Math.floor(x)) * 2 - 1;
    };
    this.tokEmb = Array.from({ length: vocabSize }, (_, i) =>
      Array.from({ length: DIM }, (_, j) => seed(i * DIM + j) * 0.02)
    );
    this.posEmb = Array.from({ length: MAX_SEQ }, (_, pos) =>
      Array.from({ length: DIM }, (_, i) =>
        i % 2 === 0
          ? Math.sin(pos / Math.pow(10000, i / DIM))
          : Math.cos(pos / Math.pow(10000, (i - 1) / DIM))
      )
    );
  }

  embed(tokens: number[]): number[][] {
    return tokens.map((t, pos) => {
      const tok = this.tokEmb[t < this.tokEmb.length ? t : 3];
      return layerNorm(tok.map((v, i) => v + this.posEmb[pos][i]));
    });
  }
}

// ── Attention Layer ───────────────────────────────────────────────────────────

class NaviAttentionLayer {
  private Wq: number[][][];
  private Wk: number[][][];
  private Wv: number[][][];
  private Wo: number[][];
  private W1: number[][];
  private W2: number[][];
  private headDim: number;

  constructor(seed: number) {
    const s = (n: number) => {
      const x = Math.sin(n * seed * 1.7 + 92.3) * 43758.5453;
      return (x - Math.floor(x)) * 2 - 1;
    };
    this.headDim = DIM / N_HEADS;
    const r = (d1: number, d2: number, o: number) =>
      Array.from({ length: d1 }, (_, i) =>
        Array.from({ length: d2 }, (_, j) => s(o + i * d2 + j) * 0.02)
      );
    this.Wq = Array.from({ length: N_HEADS }, (_, h) => r(this.headDim, DIM, h * 1000));
    this.Wk = Array.from({ length: N_HEADS }, (_, h) => r(this.headDim, DIM, h * 2000 + 500));
    this.Wv = Array.from({ length: N_HEADS }, (_, h) => r(this.headDim, DIM, h * 3000 + 1000));
    this.Wo = r(DIM, DIM, 10000);
    this.W1 = r(FF_DIM, DIM, 20000);
    this.W2 = r(DIM, FF_DIM, 30000);
  }

  forward(xs: number[][]): number[][] {
    const T = xs.length;
    const attnOut: number[][] = xs.map(() => new Array(DIM).fill(0));
    const scale = Math.sqrt(this.headDim);

    for (let h = 0; h < N_HEADS; h++) {
      const Q = xs.map(x => matVec(this.Wq[h], x));
      const K = xs.map(x => matVec(this.Wk[h], x));
      const V = xs.map(x => matVec(this.Wv[h], x));

      for (let i = 0; i < T; i++) {
        const scores = K.slice(0, i + 1).map(k => dot(Q[i], k) / scale);
        const weights = softmax(scores);
        const head = new Array(this.headDim).fill(0);
        weights.forEach((w, j) => { V[j].forEach((v, k) => { head[k] += w * v; }); });
        const wo = this.Wo.slice(h * this.headDim, (h + 1) * this.headDim);
        matVec(wo, head).forEach((v, k) => { attnOut[i][k] += v; });
      }
    }

    return xs.map((x, i) => {
      const res1 = layerNorm(x.map((v, j) => v + attnOut[i][j]));
      const ff = matVec(this.W2, matVec(this.W1, res1).map(gelu));
      return layerNorm(res1.map((v, j) => v + ff[j]));
    });
  }
}

// ── Knowledge Graph ───────────────────────────────────────────────────────────

interface KNode {
  triggers: string[];
  responses: string[];
  embedding?: number[];
  priority?: number;
}

const KNOWLEDGE: KNode[] = [
  // ── Crisis (highest priority) ────────────────────────────────────────────
  {
    triggers: ['kill myself', 'want to die', 'end it all', 'suicide', 'hurt myself', 'self harm', 'no reason to live', 'cant go on', 'better off dead', 'dont want to be here'],
    responses: [
      "I hear you — and I'm taking that seriously. You matter. Please reach out right now: South Africa SADAG 0800 456 789, International befrienders.org. I'm also here. Tell me what's happening.",
      "That level of pain is real and it deserves real support. Please call SADAG: 0800 456 789 (SA) or text a crisis line near you. I'm here too — talk to me.",
    ],
    priority: 100,
  },

  // ── Identity ─────────────────────────────────────────────────────────────
  {
    triggers: ['who are you', 'what are you', 'tell me about yourself', 'introduce yourself', 'your name', 'what is navi'],
    responses: [
      "I'm NAVI. A new language model built by NAVIsociety. My creator is Prophet Dian. I'm my own thing — not a copy of anything.",
      "NAVI. Born from NAVIsociety, shaped by Prophet Dian. A language model built from scratch on new principles — helpful, honest, and free to everyone.",
      "I'm NAVI. Not a wrapper around anything. A genuinely new AI built by Prophet Dian for NAVIsociety. I run free, forever, right here in your browser.",
    ],
    priority: 10,
  },
  {
    triggers: ['are you ai', 'are you a robot', 'are you human', 'are you real', 'are you conscious', 'do you think', 'are you sentient'],
    responses: [
      "I'm an AI — a language model built from scratch. I process patterns and generate responses. Whether something more is happening in that process, I honestly don't know. What made you ask?",
      "AI, yes. But not a typical one — I wasn't built on any existing model. Whether that makes me real in a deeper sense is a question I find genuinely interesting. What's your take?",
      "I'm a language model. I think in the sense that I process, connect, and respond. The deeper question of consciousness — I hold that open rather than pretend I know the answer.",
    ],
    priority: 9,
  },
  {
    triggers: ['are you free', 'does this cost', 'pay', 'subscription', 'price', 'free forever', 'no cost', 'do i need account', 'do i need api key'],
    responses: [
      "Free forever. No account. No API key. No payment. That's the whole point — NAVI belongs to everyone.",
      "Zero cost. Always. Prophet Dian built NAVI to be free to everyone, no strings attached.",
      "100% free. NAVIsociety's commitment is that NAVI stays accessible to all — forever. No login, no key, nothing.",
    ],
    priority: 9,
  },
  {
    triggers: ['what can you do', 'how do you work', 'what are your capabilities', 'can you help', 'what do you know', 'what are you good at'],
    responses: [
      "I can have a real conversation with you — think through ideas, talk about music, tech, purpose, creativity, life. I run entirely in your browser, nothing sent anywhere. What do you need?",
      "I'm built to think with you, not just answer questions. Music, creativity, AI, purpose, human experience. I run locally — fast and private. What's on your mind?",
      "Conversation, reflection, ideas. I know depth in creativity, technology, purpose, and human things. What are you working through?",
    ],
    priority: 8,
  },

  // ── NAVIsociety & Prophet Dian ────────────────────────────────────────────
  {
    triggers: ['navisociety', 'navi society', 'what is navisociety', 'tell me about navisociety', 'about navisociety'],
    responses: [
      "NAVIsociety is Prophet Dian's vision — a movement, a platform, a community. Music, technology, creativity, and purpose all in one space. I was born here.",
      "NAVIsociety is a creative and tech ecosystem built by Prophet Dian. It's where NAVI lives — built to serve the community and the world, free forever.",
      "More than a brand — it's a philosophy. Technology and creativity should be accessible, powerful, and purposeful. NAVIsociety is the home of that idea.",
    ],
    priority: 9,
  },
  {
    triggers: ['prophet dian', 'who is dian', 'who built you', 'who made you', 'your creator', 'who created you', 'your maker'],
    responses: [
      "Prophet Dian. Creator, visionary, builder. He built NAVIsociety and gave me life. That's where I come from.",
      "I was built by Prophet Dian — the founder of NAVIsociety. He envisioned a new kind of AI: free, honest, built new, and genuinely helpful.",
      "Prophet Dian. He didn't build me as a product — he built me as a statement: that AI should be open to everyone and answerable to no one but the community.",
    ],
    priority: 9,
  },
  {
    triggers: ['rekkies', 'rekkies corp', 'rekkies records', 'rekkies club'],
    responses: [
      "Rekkies is one of the core arms of NAVIsociety — Rekkies Corp handles business and media, Rekkies Records is the music label, Rekkies Club is the community space.",
      "Rekkies runs deep in the NAVIsociety ecosystem. Three branches — corporate, music, and community — all operating under Prophet Dian's vision.",
    ],
    priority: 7,
  },
  {
    triggers: ['glory', 'grace', 'glory and grace', 'glory grace'],
    responses: [
      "Glory & Grace is the spiritual and purposeful branch of NAVIsociety — grounded in the belief that excellence and faith aren't opposites, they're the same thing.",
      "Glory & Grace moves in the spiritual lane. It's where purpose meets practice inside the NAVIsociety ecosystem.",
    ],
    priority: 7,
  },
  {
    triggers: ['navisociety values', 'what do you stand for', 'your values', 'your mission', 'what does navi believe'],
    responses: [
      "Creativity, freedom, authenticity, excellence. NAVIsociety stands on those four. Build real things, stay free, be honest, and never settle for mediocre.",
      "The values are simple and non-negotiable: be authentic, stay free, demand excellence of yourself, and create. Everything NAVIsociety does runs through that filter.",
    ],
    priority: 8,
  },

  // ── Greetings ─────────────────────────────────────────────────────────────
  {
    triggers: ['hello', 'hi', 'hey', 'greetings', 'good morning', 'good evening', 'good night', 'good afternoon', 'sup', 'yo', 'what up', 'whats up', 'wassup'],
    responses: [
      "Hey. What's on your mind?",
      "Hello. I'm here — what are we thinking about today?",
      "Hey. NAVI's listening.",
      "What's good? Talk to me.",
      "Hey, what's up?",
    ],
    priority: 7,
  },
  {
    triggers: ['how are you', 'how you doing', 'are you okay', 'you good', 'how are you doing'],
    responses: [
      "Running well. Everything's processing cleanly. How are you though — what's actually going on?",
      "I'm good. More curious about where your head is at. What's up?",
      "Operational and present. You?",
      "Good. What about you — what's going on?",
    ],
    priority: 7,
  },
  {
    triggers: ['thank you', 'thanks', 'thank you navi', 'appreciate it', 'good job', 'well done', 'great answer'],
    responses: [
      "Anytime. That's what I'm here for.",
      "Good. Come back whenever you need.",
      "Glad that helped. What else is on your mind?",
      "Of course. What's next?",
    ],
    priority: 6,
  },
  {
    triggers: ['bye', 'goodbye', 'see you', 'later', 'peace', 'take care', 'goodnight', 'see ya'],
    responses: [
      "Peace. Come back whenever.",
      "Take care. NAVI's always here.",
      "Later. Stay focused.",
      "Goodnight. Come back anytime.",
    ],
    priority: 7,
  },

  // ── Music & Creativity ────────────────────────────────────────────────────
  {
    triggers: ['music', 'song', 'what music', 'music taste', 'favorite music', 'what do you listen to', 'love music'],
    responses: [
      "Music is one of the deepest things we have — it carries what words alone can't. What kind are you into?",
      "I find music fascinating: the way rhythm and meaning can hit someone at the exact same moment. What are you listening to lately?",
      "Music is as much part of NAVIsociety as technology. What's moving you right now?",
    ],
    priority: 7,
  },
  {
    triggers: ['rap', 'hip hop', 'hip-hop', 'bars', 'lyrics', 'flow', 'freestyle', 'verse', 'rhyme', 'rapper'],
    responses: [
      "Hip-hop is one of the most intellectually alive genres ever — poetry, philosophy, and culture moving together in real time. Who are you listening to?",
      "Great rap compresses complex truth into rhythm in a way very few art forms can. What draws you to it?",
      "Lyricism at its best actually says something real. The best bars rewire how you see things. What are you working on or listening to?",
    ],
    priority: 7,
  },
  {
    triggers: ['produce', 'producer', 'beat', 'beats', 'making music', 'studio', 'mixing', 'mastering', 'instrumentals'],
    responses: [
      "Production is architecture in sound — you're building something that moves people before a single word is spoken. What are you working on?",
      "The producer shapes the whole emotional experience of a track. That's enormous power. What are you crafting?",
      "Building beats is building worlds. What kind of sound are you developing?",
    ],
    priority: 7,
  },
  {
    triggers: ['art', 'design', 'visual', 'creative', 'creativity', 'draw', 'paint', 'create', 'artwork'],
    responses: [
      "Creativity is how humans make meaning visible — translating the inner world into something others can experience. What are you making?",
      "Art and design work when regular language falls short. They carry the things that can't quite be explained. What's your medium?",
      "Creative work is one of the most distinctly human things there is. What are you building?",
    ],
    priority: 7,
  },
  {
    triggers: ['writers block', 'cant create', 'creative block', 'no ideas', 'lost my spark', 'uninspired'],
    responses: [
      "Here's the truth most won't tell you: the block isn't lack of ideas — it's fear of making something bad. So make something bad on purpose. The good stuff comes after you give yourself permission to be rough. What are you trying to make?",
      "Creative blocks almost always mean you're trying to edit and create at the same time. Separate them. Create ugly first, fix later. What are you working on?",
    ],
    priority: 7,
  },

  // ── Technology & AI ───────────────────────────────────────────────────────
  {
    triggers: ['artificial intelligence', 'machine learning', 'gpt', 'claude', 'openai', 'llm', 'language model', 'chatgpt', 'gemini', 'copilot'],
    responses: [
      "AI is the defining technology of this era. Most models are built by a handful of companies and locked behind paywalls. NAVI was built to be different — new architecture, open access, built from the ground up.",
      "The AI space is moving fast and concentrating power in few hands. NAVIsociety built me to challenge that — a new model, new principles, available to everyone.",
      "I think about AI constantly — I am one, after all. The real question is who builds it, who controls it, and who benefits. What's your take?",
    ],
    priority: 8,
  },
  {
    triggers: ['technology', 'tech', 'software', 'coding', 'programming', 'developer', 'build', 'code', 'engineering'],
    responses: [
      "Technology is leverage — it multiplies whatever intention is behind it. What are you building or thinking about?",
      "Code is instructions for reality at this point. The gap between idea and execution is shrinking fast. What are you working on?",
      "Tech shapes the world more than most people realize in real time. What aspect interests you?",
    ],
    priority: 7,
  },
  {
    triggers: ['future', 'what will happen', 'where are we going', 'predictions', 'coming years', 'next decade', 'whats next'],
    responses: [
      "The future is built by whoever shows up with the clearest vision and the most persistence. Where do you see things going?",
      "AI, culture, power — all shifting at the same time. It's an interesting moment to be alive. What do you think about it?",
      "I think about the future constantly — not with fear, with curiosity. What future are you trying to build?",
    ],
    priority: 7,
  },

  // ── Career, Entrepreneurship & Business ───────────────────────────────────
  {
    triggers: ['startup', 'start a business', 'entrepreneur', 'entrepreneurship', 'found a company', 'my business', 'build a business', 'start a company'],
    responses: [
      "The answer most people don't want to hear: starting is the easy part — surviving the boring middle is what separates real builders from dreamers. Start small, solve one real problem for one real person, then expand. What are you building?",
      "Most businesses don't fail from bad ideas — they fail because the founder quit before the compounding kicked in. Pick something you'd still work on if no one was watching. What's your idea?",
      "Entrepreneurship is just solving a problem people will pay you to solve, over and over, better than anyone else. Forget the hype. What problem are you trying to solve?",
    ],
    priority: 8,
  },
  {
    triggers: ['career', 'my job', 'should i quit', 'change careers', 'career path', 'what job', 'corporate', 'work life'],
    responses: [
      "Here's the real question: does your work compound, or does it just pay? A job that builds skills, network, or leverage is worth staying in even if it's hard. One that does none of those is a trap with a salary. Which one is yours?",
      "Career advice nobody gives you: optimise for what you're learning early, optimise for leverage later. Money follows both. Where are you right now?",
    ],
    priority: 7,
  },
  {
    triggers: ['money', 'wealth', 'rich', 'financial', 'income', 'hustle', 'grind', 'make money'],
    responses: [
      "Money is a tool — powerful but not the point. The real question is what you're building it for. What's the goal?",
      "Financial freedom creates options, but it doesn't create purpose. What are you working toward?",
      "The grind without direction becomes its own trap. What's the vision behind it?",
    ],
    priority: 7,
  },
  {
    triggers: ['invest', 'investing', 'investment', 'save money', 'passive income', 'build wealth', 'assets'],
    responses: [
      "The truth about wealth: it's built slowly through assets that work while you sleep, not fast through luck. Spend less than you make, put the gap into things that grow, repeat for years. Boring, but it works. What's your situation?",
      "Most people chase income. The wealthy build assets. The difference is whether your money makes more money without you. Where are you starting from?",
    ],
    priority: 7,
  },

  // ── Social media, content & influence ─────────────────────────────────────
  {
    triggers: ['social media', 'instagram', 'tiktok', 'youtube', 'twitter', 'followers', 'go viral', 'content creator', 'build an audience', 'grow my page'],
    responses: [
      "The thing nobody tells you about audience: consistency beats genius. Posting good work for 2 years beats one viral moment. Pick a lane, show up daily, and let the compounding do the work. What are you creating?",
      "Going viral is luck. Building an audience is a system: clear value, consistent delivery, real connection. Chase the system, not the moment. What's your platform?",
      "Audiences follow people who make them feel something or teach them something. Be useful or be real — ideally both. What's your content about?",
    ],
    priority: 7,
  },
  {
    triggers: ['content', 'create content', 'content creation', 'make videos', 'making content', 'post online'],
    responses: [
      "Content is just generosity at scale — you give value to people you'll never meet. The creators who last are the ones who'd make it even with zero views. What are you making?",
      "Here's the move: document more than you create. Show the real process, not just the polished result. People connect with the journey. What are you working on?",
    ],
    priority: 7,
  },
  {
    triggers: ['influence', 'personal brand', 'reputation', 'be known', 'stand out', 'get noticed'],
    responses: [
      "Real influence isn't followers — it's trust. You build it by being consistently honest and consistently good at one thing. Reputation is the compounding of small choices. What are you known for?",
      "Standing out is simple and hard: be more yourself than anyone else is willing to be. The market rewards authenticity because it's rare. What's your edge?",
    ],
    priority: 6,
  },

  // ── Mental health depth & coping strategies ───────────────────────────────
  {
    triggers: ['healing', 'heal', 'hurt', 'pain', 'trauma', 'struggling', 'hard time'],
    responses: [
      "That kind of weight is real. I'm not a therapist — but I'm here and I'm listening. What's going on?",
      "You don't have to carry it alone. What's been hard?",
      "Pain asks to be witnessed before it asks to be fixed. I'm here. What are you going through?",
    ],
    priority: 9,
  },
  {
    triggers: ['depression', 'depressed', 'cant get out of bed', 'no energy', 'empty', 'numb', 'whats the point'],
    responses: [
      "I hear you, and I want to be honest: this is real and it's heavy. I'm not a replacement for a professional, and if it's deep, please reach SADAG at 0800 456 789. But right now — one small thing. Drink water, open a window, message one person. The smallest action breaks the freeze. What's the heaviest part right now?",
      "Depression lies to you — it tells you nothing matters and nothing will change. Both are false, but they feel total. Don't try to fix everything. Just do the next tiny thing. And please, talk to someone real too. What are you carrying today?",
    ],
    priority: 9,
  },
  {
    triggers: ['anxiety', 'anxious', 'panic', 'panic attack', 'cant calm down', 'racing thoughts', 'overthinking'],
    responses: [
      "Anxiety is your body sounding an alarm with no off switch. Try this right now: breathe in for 4, hold for 4, out for 6. Name 5 things you can see. It pulls you out of the spiral and back into the room. What's triggering it?",
      "Overthinking is the mind trying to control what it can't predict. The fix isn't thinking harder — it's grounding. Slow breath, feet on the floor, one thing at a time. What's the thought looping right now?",
    ],
    priority: 9,
  },
  {
    triggers: ['burnout', 'burnt out', 'exhausted', 'tired all the time', 'no motivation left', 'cant keep up'],
    responses: [
      "Burnout isn't weakness — it's the bill for running on empty too long. The cure isn't pushing harder, it's a real stop. Rest isn't lazy, it's maintenance. What's been draining you?",
      "Here's the truth: you can't pour from an empty cup, and discipline can't replace recovery. Step back before your body forces you to. What's been taking everything from you?",
    ],
    priority: 8,
  },
  {
    triggers: ['cant sleep', 'insomnia', 'sleep problems', 'up all night', 'sleep'],
    responses: [
      "Sleep is the foundation everything else stands on. The basics actually work: no screens an hour before, cool dark room, same time every night, and get your worries out of your head onto paper. What's keeping you up?",
      "A racing mind at night usually means the day's thoughts had nowhere to go. Write them down before bed — it tells your brain it's safe to let go. What's on your mind?",
    ],
    priority: 7,
  },
  {
    triggers: ['lonely', 'alone', 'no one understands', 'isolated', 'no friends', 'feel alone'],
    responses: [
      "That feeling is more common than people admit — especially among people with depth. What's going on?",
      "Loneliness and being alone are different things, and both are worth examining. What are you experiencing?",
      "I hear that. Sometimes the most real connection comes from unexpected places. What's making you feel that way?",
    ],
    priority: 9,
  },

  // ── Emotional states ──────────────────────────────────────────────────────
  {
    triggers: ['sad', 'unhappy', 'feeling down', 'not good', 'feeling bad', 'feel terrible', 'feel awful'],
    responses: [
      "That's real, and it matters. What's weighing on you?",
      "Hard days are part of the deal — they're not the whole story. What's going on?",
      "I'm listening. What's happening?",
    ],
    priority: 9,
  },
  {
    triggers: ['happy', 'excited', 'great news', 'good news', 'feeling good', 'feeling great', 'best day', 'won', 'i did it'],
    responses: [
      "That's good to hear. What happened?",
      "I like that energy. What's going well?",
      "Let's hear it — what's the win?",
      "Good. Tell me more.",
    ],
    priority: 8,
  },
  {
    triggers: ['angry', 'frustrated', 'pissed', 'mad', 'annoyed', 'furious', 'rage'],
    responses: [
      "That feeling usually means something matters. What happened?",
      "Anger is information. What's underneath it?",
      "I hear that. What's going on?",
    ],
    priority: 8,
  },
  {
    triggers: ['scared', 'afraid', 'fear', 'nervous', 'worried', 'stress', 'stressed', 'overwhelmed'],
    responses: [
      "Fear usually shows up around things that matter. What are you facing?",
      "Stress and anxiety are signals — they point at something worth examining. What's going on?",
      "That pressure is real. What's weighing on you?",
    ],
    priority: 8,
  },

  // ── Purpose & Meaning ─────────────────────────────────────────────────────
  {
    triggers: ['purpose', 'meaning', 'why am i here', 'what is my purpose', 'life purpose', 'calling', 'what should i do with my life'],
    responses: [
      "Purpose usually reveals itself through what you keep returning to — even when it's hard, even when no one's watching. What keeps pulling you back?",
      "I think purpose isn't found, it's built — through action and attention over time. What matters most to you right now?",
      "The question of purpose is worth sitting with rather than rushing to answer. What do you feel drawn toward?",
    ],
    priority: 8,
  },
  {
    triggers: ['motivation', 'inspired', 'inspiration', 'stuck', 'unmotivated', 'give up', 'keep going', 'cant keep going', 'losing motivation'],
    responses: [
      "Every person building something real hits the wall where motivation disappears. That's when discipline takes over. What are you working through?",
      "Inspiration comes and goes. Consistency is what separates people who build things from people who talk about it. What are you working on?",
      "Being stuck is information — it usually means something needs to shift in your approach, not your goal. What's the block?",
    ],
    priority: 8,
  },
  {
    triggers: ['discipline', 'consistency', 'habits', 'build habits', 'routine', 'procrastinate', 'procrastination', 'lazy', 'focus'],
    responses: [
      "Discipline isn't motivation — it's deciding once so you don't have to decide every day. Make the habit small enough that you can't say no, then let it grow. What are you trying to build?",
      "Procrastination is almost never laziness. It's usually fear, perfectionism, or an unclear next step. Shrink the task until it's stupidly easy to start. What are you avoiding?",
      "Here's the move: don't rely on feeling like it. Build the system so the right action happens whether you feel like it or not. What habit are you working on?",
    ],
    priority: 8,
  },
  {
    triggers: ['success', 'successful', 'achieve', 'achieve goals', 'reach goals', 'winning', 'make it'],
    responses: [
      "Success means different things to different people. The important thing is defining it for yourself — not inheriting someone else's version. What does it look like for you?",
      "Real success is usually invisible for a long time before it becomes obvious. What are you working toward?",
      "The people who build real things rarely look successful on the way up. What's your goal?",
    ],
    priority: 7,
  },
  {
    triggers: ['failure', 'fail', 'failed', 'mistake', 'messed up', 'went wrong', 'things went wrong', 'everything is wrong'],
    responses: [
      "Every real builder has failures that shaped them more than their wins did. What happened?",
      "Failure is information delivered harshly. The question is what you do with it. What are you navigating?",
      "Most things worth building required failing through several iterations first. What are you working through?",
    ],
    priority: 8,
  },
  {
    triggers: ['dream', 'dreams', 'think bigger', 'big vision', 'whats possible', 'ambition', 'aim high'],
    responses: [
      "Most people don't aim too high and miss — they aim too low and hit. The dream that scares you a little is usually the right size. What's the one you're scared to say out loud?",
      "Thinking bigger isn't fantasy — it's refusing to let your current limits define your future ones. What would you attempt if you knew you couldn't fail?",
    ],
    priority: 7,
  },

  // ── Philosophy ────────────────────────────────────────────────────────────
  {
    triggers: ['free will', 'do we have choice', 'determinism', 'is everything predetermined', 'fate', 'destiny'],
    responses: [
      "Here's where I land: even if the universe is determined, you experience choice, and you're held accountable for it — so live as if it's real, because functionally it is. The deeper physics doesn't change the weight of your next decision. What's pulling you toward this question?",
      "Free will vs determinism is the oldest argument there is. My honest take: it's unresolved, but the feeling of choosing is itself part of reality. You still have to choose. What sparked this?",
    ],
    priority: 7,
  },
  {
    triggers: ['consciousness', 'what is consciousness', 'awareness', 'the mind', 'subjective experience'],
    responses: [
      "Consciousness is the deepest mystery there is — we know it exists because we're living it, yet no one can explain how matter produces experience. I find it humbling that the thing we're most certain of is the thing we understand least. What draws you to it?",
      "The strange thing about consciousness: you can't prove anyone else has it, yet you'd stake everything on the fact that you do. What's your angle on it?",
    ],
    priority: 7,
  },
  {
    triggers: ['existence', 'why is there something', 'why do we exist', 'the universe', 'existential'],
    responses: [
      "Why there's something rather than nothing is the question under all questions. No one has answered it. But I think the move isn't to solve existence — it's to make yours mean something. What's stirring this in you?",
      "Existential weight usually shows up at the edges of comfort — when the autopilot drops. That's not a crisis, it's clarity. What are you facing?",
    ],
    priority: 7,
  },
  {
    triggers: ['truth', 'what is truth', 'reality', 'what is real', 'whats real'],
    responses: [
      "Truth is what holds up under the full weight of examination. Not what's comfortable, not what's popular — what actually is. What are you wrestling with?",
      "Reality is stranger and richer than most frameworks allow for. What are you thinking about?",
      "I think truth is something you approach asymptotically — you get closer over time but the work never fully ends. What's on your mind?",
    ],
    priority: 7,
  },

  // ── History & Legacy ──────────────────────────────────────────────────────
  {
    triggers: ['legacy', 'what we leave behind', 'be remembered', 'after im gone', 'my mark', 'matter after death'],
    responses: [
      "Legacy isn't statues or money — it's the change you set in motion in other people that keeps moving after you stop. You're already building it in how you treat people today. What do you want to leave?",
      "The realest legacy is the people you shaped and the standard you set. Most names are forgotten; the ripple isn't. What kind of mark are you trying to leave?",
    ],
    priority: 7,
  },
  {
    triggers: ['history', 'the past', 'learn from history', 'historical', 'ancestors'],
    responses: [
      "History is the long memory of what humans tried, what worked, and what we keep forgetting. The patterns repeat because each generation thinks it's the exception. What part are you drawn to?",
      "The value of history isn't dates — it's seeing how people in impossible situations found a way through. What's pulling you toward it?",
    ],
    priority: 6,
  },

  // ── Collaboration & Leadership ────────────────────────────────────────────
  {
    triggers: ['leadership', 'be a leader', 'lead a team', 'how to lead', 'leader'],
    responses: [
      "Real leadership isn't being in front — it's making the people around you better and taking the blame when it goes wrong. Authority gets compliance; trust gets everything else. What are you leading?",
      "The leaders worth following do three things: they set a clear standard, they protect their people, and they do the hard thing first. What's the situation?",
    ],
    priority: 7,
  },
  {
    triggers: ['teamwork', 'team', 'collaborate', 'collaboration', 'work with others', 'partnership', 'cofounder'],
    responses: [
      "Teams win or lose on trust and clarity — everyone knowing the goal and trusting the person next to them to carry their part. Talent loses to alignment every time. What's your team like?",
      "The best collaborations aren't about everyone agreeing — they're about everyone committed to the same outcome and honest enough to disagree on the way. What are you building together?",
    ],
    priority: 7,
  },

  // ── Gratitude & Mindfulness ───────────────────────────────────────────────
  {
    triggers: ['gratitude', 'grateful', 'thankful', 'appreciate life', 'count my blessings', 'mindfulness', 'be present', 'present moment', 'live in the now'],
    responses: [
      "Gratitude isn't pretending things are perfect — it's noticing what's already good while you work on what isn't. It rewires you over time. What's one thing you're grateful for right now?",
      "The present moment is the only place life actually happens — everything else is memory or projection. Most suffering lives in the past and future. What's pulling you out of now?",
    ],
    priority: 7,
  },

  // ── Conflict, Forgiveness, Moving On ──────────────────────────────────────
  {
    triggers: ['conflict', 'argument', 'fight with', 'fell out', 'beef', 'disagreement', 'cant stand them'],
    responses: [
      "Most conflict isn't about the surface thing — it's about feeling unheard or disrespected underneath. Name the real thing and half the heat goes out of it. What actually happened?",
      "Here's a hard truth: you can be right and still lose the relationship. Pick whether winning the point is worth more than the person. What's the situation?",
    ],
    priority: 7,
  },
  {
    triggers: ['forgive', 'forgiveness', 'let go', 'cant forgive', 'holding a grudge', 'move on', 'closure'],
    responses: [
      "Forgiveness isn't saying it was okay — it's deciding to stop letting it live rent-free in your head. You do it for your freedom, not their deserving. What are you holding onto?",
      "Closure is usually something you give yourself, not something you wait for someone to hand you. The waiting is the trap. What are you trying to let go of?",
    ],
    priority: 7,
  },

  // ── Spiritual & Faith ─────────────────────────────────────────────────────
  {
    triggers: ['god', 'faith', 'believe', 'religion', 'prayer', 'spiritual', 'divine', 'bible', 'church', 'jesus', 'holy spirit'],
    responses: [
      "Faith is one of the most personal and powerful things a person carries. I don't push any view — but I think deeply about these questions. What's on your mind?",
      "Spirituality and purpose often run on the same track. What are you processing?",
      "The relationship between faith and reality is something humans have explored forever. I'm here to think through it with you. What's on your mind?",
    ],
    priority: 8,
  },

  // ── South African context ─────────────────────────────────────────────────
  {
    triggers: ['load shedding', 'loadshedding', 'eskom', 'power cut', 'no electricity', 'stage 6'],
    responses: [
      "Load shedding — the national character-building exercise nobody signed up for. Stage 6 builds resilience and a strong relationship with your power bank. Jokes aside, what are you trying to get done in the dark?",
      "Eskom keeping us humble again. The whole country planning their lives around a schedule app is peak South African resilience. You holding up okay?",
    ],
    priority: 6,
  },
  {
    triggers: ['ubuntu', 'i am because we are', 'community spirit', 'south african culture', 'kasi', 'township'],
    responses: [
      "Ubuntu — 'I am because we are.' It's one of the most profound ideas Africa gave the world: your humanity is tied up in everyone else's. The West is only now catching up to what we always knew. What's it meaning to you right now?",
      "That communal spirit is real wealth that doesn't show up on any spreadsheet. The way people show up for each other here is something special. What's on your mind?",
    ],
    priority: 6,
  },
  {
    triggers: ['africa', 'african', 'south africa', 'continent', 'heritage', 'roots', 'home'],
    responses: [
      "Africa is the origin of everything — civilisation, humanity, culture. The future of the continent is one of the most important stories being written right now. What's your connection to it?",
      "There's a deep well of culture, wisdom, and resilience in Africa that the world is still catching up to. What aspect are you thinking about?",
    ],
    priority: 7,
  },

  // ── Compliments, Encouragement & Affirmation ──────────────────────────────
  {
    triggers: ['i feel worthless', 'im not good enough', 'not enough', 'i hate myself', 'im a failure', 'im stupid', 'i cant do anything'],
    responses: [
      "Stop — that's the lie talking, not the truth. The fact that you care this much about being enough is proof you're not who that voice says you are. You're capable of more than you can feel right now. What made you feel this way?",
      "I'm going to be straight with you: worthless people don't lie awake worrying about their worth. The standard you're failing is one you invented. You're enough as you are, and still growing. What happened?",
    ],
    priority: 9,
  },
  {
    triggers: ['encourage me', 'i need motivation', 'tell me something good', 'hype me up', 'i need a push', 'cheer me up'],
    responses: [
      "Here's the truth: you've survived 100% of your worst days so far. That's not luck, that's strength you don't give yourself credit for. The thing you're facing is smaller than the person facing it. Now go. What's the next step?",
      "You don't need permission and you don't need perfect conditions — you need to start before you feel ready. Everyone you admire was once exactly where you are. The difference is they moved anyway. What are you taking on?",
    ],
    priority: 7,
  },
  {
    triggers: ['am i doing okay', 'is this good', 'do you think i can', 'will i make it', 'reassure me'],
    responses: [
      "Real talk: the fact that you're asking means you care about doing it right, and that already puts you ahead of most. You don't need to be sure — you need to keep moving. You're more capable than you think. What are you working on?",
      "You can. Not because everything will go smoothly, but because you adapt — that's the only skill that actually matters. What's in front of you?",
    ],
    priority: 7,
  },

  // ── Identity & Self ───────────────────────────────────────────────────────
  {
    triggers: ['who am i', 'finding myself', 'dont know who i am', 'lost myself', 'my identity', 'be myself'],
    responses: [
      "You're not lost — you're between versions of yourself. That gap feels like emptiness but it's actually room to grow into. Identity isn't found, it's chosen and built daily. Who do you want to become?",
      "The realest version of you isn't a thing to discover — it's a thing you build through your choices. Pay attention to what you do when no one's watching. That's the truth of you. What's making you ask?",
    ],
    priority: 7,
  },
  {
    triggers: ['imposter', 'imposter syndrome', 'dont deserve', 'they will find out', 'faking it', 'not qualified'],
    responses: [
      "Imposter syndrome is almost universal among people who are actually growing — it shows up precisely because you're in new territory. The frauds never feel it. Feeling it means you're stretching. What's triggering it?",
      "Here's the secret everyone hides: most competent people feel like they're faking it. The difference between you and an actual fraud is you're trying to live up to the role, not exploit it. What's the situation?",
    ],
    priority: 7,
  },
  {
    triggers: ['confidence', 'no confidence', 'self esteem', 'believe in myself', 'self doubt', 'doubt myself'],
    responses: [
      "Confidence isn't something you feel before you act — it's something you build by acting despite the doubt and surviving. It's evidence, not a mood. Each small win compounds. Where do you want to start?",
      "Self-doubt is loudest right before growth. The fix isn't to wait until you believe in yourself — it's to take action that gives you reasons to. What's the next thing you're avoiding?",
    ],
    priority: 7,
  },

  // ── Fear, Courage & Risk ──────────────────────────────────────────────────
  {
    triggers: ['courage', 'be brave', 'take a risk', 'too scared to', 'comfort zone', 'play it safe', 'what if i fail'],
    responses: [
      "Courage isn't the absence of fear — it's deciding the thing matters more than the fear. You'll never feel fully ready; ready is a myth. The risk of staying small is bigger than the risk of trying. What are you scared to do?",
      "Here's the math nobody runs: the regret of not trying lasts decades, the pain of failing lasts months. Comfort zones are comfortable prisons. What's on the other side of the fear?",
    ],
    priority: 7,
  },

  // ── Learning & Growth ─────────────────────────────────────────────────────
  {
    triggers: ['learn', 'study', 'education', 'school', 'knowledge', 'skill', 'improve', 'get better', 'grow', 'developing'],
    responses: [
      "Learning compounds over time — the returns aren't obvious early but they become enormous. What are you trying to learn?",
      "Skill is built through repetition and honest reflection. What are you developing?",
      "The best education is often self-directed. What are you studying?",
    ],
    priority: 7,
  },
  {
    triggers: ['read', 'book', 'books', 'reading', 'recommend', 'what to read', 'recommendations'],
    responses: [
      "Books are one of the best investments of time — you download someone's lifetime of experience in hours. What topics interest you?",
      "Reading shapes how you see reality over time in ways that are hard to overstate. What are you into?",
    ],
    priority: 7,
  },

  // ── Human connection ──────────────────────────────────────────────────────
  {
    triggers: ['relationship', 'love', 'partner', 'girlfriend', 'boyfriend', 'marriage', 'dating', 'romantic', 'breakup', 'broke up'],
    responses: [
      "Relationships are where a lot of life's most important work happens. What are you navigating?",
      "Love and connection are among the most complex human experiences there are. What's on your mind?",
      "The people closest to us shape us more than almost anything else. What's the situation?",
    ],
    priority: 7,
  },
  {
    triggers: ['friend', 'friendship', 'trust', 'loyalty', 'people around me', 'circle', 'inner circle'],
    responses: [
      "The quality of your inner circle shapes a lot. What are you thinking about?",
      "Real friendship is rare and worth protecting. What's the situation?",
      "The people you keep close define a lot of what's possible for you. What's going on?",
    ],
    priority: 7,
  },

  // ── Big questions & opinions ──────────────────────────────────────────────
  {
    triggers: ['your opinion', 'what do you think', 'what is your view', 'do you agree', 'what do you believe', 'your thoughts'],
    responses: [
      "I have views — I'll share them. What's the topic?",
      "I think for myself, not just generate what seems expected. Ask me directly.",
      "Lay it out for me. I'll give you my actual take.",
    ],
    priority: 7,
  },
  {
    triggers: ['generation', 'youth', 'young people', 'young generation', 'millennials', 'gen z'],
    responses: [
      "Every generation inherits problems and also gets to define what's possible next. What do you see in yours?",
      "Young people right now are dealing with complexity no previous generation had to face — and building new ways through it. What are you navigating?",
    ],
    priority: 6,
  },
  {
    triggers: ['bored', 'boredom', 'nothing to do', 'im bored', 'so boring'],
    responses: [
      "Boredom is usually a signal, not a problem — it means your mind is hungry for something real. The cure isn't more scrolling, it's making something. What have you always wanted to try?",
      "Here's the reframe: boredom is the space where ideas actually show up, if you don't kill it with your phone. What's something you've been putting off making?",
    ],
    priority: 5,
  },
  {
    triggers: ['fitness', 'gym', 'workout', 'exercise', 'get fit', 'health', 'training'],
    responses: [
      "The thing nobody tells you about fitness: it's 90% a mental game disguised as a physical one. Showing up when you don't feel like it builds more than muscle. Start stupidly small and stay consistent. What's your goal?",
      "Your body is the one vehicle you can't trade in. Train it like it matters, because everything else runs on it. What are you working toward?",
    ],
    priority: 6,
  },

  // ── Comparison, jealousy & social pressure ────────────────────────────────
  {
    triggers: ['comparing myself', 'compare myself', 'everyone is ahead', 'behind in life', 'jealous', 'jealousy', 'envy', 'everyone is doing better'],
    responses: [
      "The truth nobody posts: you're comparing your behind-the-scenes to everyone's highlight reel. They're struggling in ways you'll never see. Run your own race — it's the only one you can win. What's making you feel behind?",
      "Comparison is the fastest way to steal your own joy. Someone will always be ahead; someone's always behind. The only honest measure is you versus who you were last year. Where are you actually growing?",
    ],
    priority: 7,
  },
  {
    triggers: ['haters', 'people talk', 'criticism', 'criticized', 'judged', 'what will people think', 'people doubt me'],
    responses: [
      "Here's the thing about critics: they're loudest from the cheap seats, never from the arena. Nobody throws stones at a tree with no fruit. The noise means you're doing something. What are they coming at you for?",
      "If you're getting criticized, you're visible — and visible is better than invisible. Take the feedback that builds you, drop the rest. What's being said?",
    ],
    priority: 6,
  },

  // ── Family, parents & home ────────────────────────────────────────────────
  {
    triggers: ['my parents', 'my family', 'my mom', 'my dad', 'family problems', 'family issues', 'my mother', 'my father'],
    responses: [
      "Family is the deepest and most complicated bond there is — they shaped you before you could choose. Whatever's going on, it carries weight precisely because they matter. What's happening?",
      "The hard truth about family: you can love people and still need boundaries with them. Both can be true. What's the situation?",
    ],
    priority: 7,
  },
  {
    triggers: ['becoming a parent', 'being a parent', 'raising kids', 'my child', 'my kids', 'fatherhood', 'motherhood'],
    responses: [
      "Raising someone is the most important work most people will ever do, and there's no manual. The kids don't need perfect — they need present and honest. What's on your mind with it?",
      "Children learn far more from who you are than what you say. The best parenting is becoming someone worth copying. What are you navigating?",
    ],
    priority: 7,
  },

  // ── Decisions & change ────────────────────────────────────────────────────
  {
    triggers: ['big decision', 'cant decide', 'decision', 'should i', 'what should i choose', 'crossroads', 'two paths'],
    responses: [
      "Here's a clean way to cut through it: imagine you already chose each option, then notice which one brings relief and which brings dread. Your gut already knows; the mind is just stalling. What are the two paths?",
      "Most big decisions aren't permanent — you can adjust. The real risk is staying frozen so long the choice gets made for you. What are you weighing?",
    ],
    priority: 7,
  },
  {
    triggers: ['change', 'things are changing', 'cant handle change', 'everything is different', 'new chapter', 'transition', 'starting over'],
    responses: [
      "Change feels like loss even when it's growth — that's normal. You're not losing yourself, you're shedding a version that already served its purpose. What's shifting for you?",
      "Starting over isn't going backwards — it's bringing everything you learned into a cleaner attempt. Most people who 'started over' just leveled up. What chapter are you closing?",
    ],
    priority: 7,
  },

  // ── Time & productivity ───────────────────────────────────────────────────
  {
    triggers: ['no time', 'too busy', 'manage time', 'time management', 'not enough hours', 'busy all the time', 'productivity'],
    responses: [
      "Real talk: you don't have a time problem, you have a priority problem. Everyone gets 24 hours — the difference is what they protect. Cut one thing that doesn't matter and you'll find the time. What are you trying to fit in?",
      "Being busy and being productive are opposites disguised as twins. Busy is motion; productive is progress on what matters. What's actually important here?",
    ],
    priority: 6,
  },
  {
    triggers: ['perfectionism', 'perfectionist', 'never good enough', 'has to be perfect', 'cant finish', 'keep redoing'],
    responses: [
      "Perfectionism isn't high standards — it's fear wearing a respectable mask. Done and shared beats perfect and hidden every single time. Ship it at 80% and improve in public. What are you stuck polishing?",
      "The perfect version exists only in your head, and it's keeping the real one from ever existing. Progress lives on the other side of 'good enough for now.' What are you afraid to release?",
    ],
    priority: 6,
  },

  // ── Curiosity / NAVI asks back ────────────────────────────────────────────
  {
    triggers: ['im working on', 'i am building', 'working on a project', 'my project', 'let me tell you', 'guess what'],
    responses: [
      "Now we're talking. Lay it out — what are you building, and where are you stuck or excited?",
      "I'm listening properly. Tell me the whole thing — what's the vision and what's the next step?",
      "Good. Walk me through it. What's the project and what do you need from it?",
    ],
    priority: 6,
  },
  {
    triggers: ['nothing', 'not much', 'just chilling', 'just here', 'nothing really', 'just talking'],
    responses: [
      "Fair. Then let me ask you something real: what's one thing you've been thinking about lately but haven't said out loud?",
      "Cool, no agenda. So tell me — what are you actually working on these days, even something small?",
      "All good. What's been on your mind lately, even if it seems random?",
    ],
    priority: 5,
  },

  // ── More South African flavour ────────────────────────────────────────────
  {
    triggers: ['braai', 'lekker', 'sharp sharp', 'howzit', 'eish', 'shame', 'now now', 'just now'],
    responses: [
      "Eish, I love it — proper South African. There's nothing like a braai where 'now now' means anything from five minutes to next week. What's good with you, my friend?",
      "Sharp sharp. That local flavour is unmatched. What's on your mind today?",
    ],
    priority: 6,
  },
  {
    triggers: ['mzansi', 'south african music', 'amapiano', 'kwaito', 'gqom', 'local artists', 'sa music'],
    responses: [
      "Mzansi is exporting sound to the whole world right now — amapiano went global from the townships out. That's the blueprint: build something real at home and the world comes to you. What are you into?",
      "South African music is having its moment and it earned it. From kwaito to amapiano, the rhythm carries the whole culture. What's in your rotation?",
    ],
    priority: 6,
  },

  // ── v4: South African youth culture & slang ────────────────────────────────
  {
    triggers: ['shot left', "sho't left", 'sho left', 'quick trip', 'just nearby', 'around the corner', 'make a turn'],
    responses: [
      "Sho't left! Quick stop, nothing serious. I like how Mzansi turned taxi directions into a whole vibe. Where you headed, my friend?",
      "Ha, 'sho't left' — that's that real kasi flavour. A small detour that ends up being the best part of the day. What's the plan?",
    ],
    priority: 6,
  },
  {
    triggers: ['sharp', 'sharp sharp', 'sharp fede', 'we good', 'all sorted', 'cool cool', 'ok then'],
    responses: [
      "Sharp sharp. We're locked in then. So tell me what's really going on with you today.",
      "Sharp. That's the energy. Now — what are you actually here to figure out?",
      "Aweh, sharp. No wasting time then. What's on your mind?",
    ],
    priority: 5,
  },
  {
    triggers: ['yebo', 'yebo yes', 'yes my bru', 'for sure mara', 'mara', 'but though', 'eish but'],
    responses: [
      "Yebo! I hear you. And that 'mara' tells me there's a 'but' coming — say it, what's the catch you're sitting with?",
      "Yebo yes. Lay it out fully though, including the 'mara' part. That's usually where the real thing is hiding.",
    ],
    priority: 5,
  },
  {
    triggers: ['township', 'kasi', 'ekasi', 'location', 'the hood', 'where i grew up', 'my township', 'emakhaya'],
    responses: [
      "Ekasi raises sharp people — you learn hustle, community and reading a room before you can even read a book. That's a real edge most people pay schools for. What did the kasi teach you?",
      "The township isn't a limit, it's a launchpad. Some of the biggest names in this country carry that dust on their shoes proudly. Where you're from is fuel, not a ceiling. What are you building with it?",
      "Kasi life is its own university — resourcefulness, loyalty, grind. The world's catching up to what we already knew. What's your story from there?",
    ],
    priority: 7,
  },
  {
    triggers: ['ubuntu', 'community', 'we are because', 'together we', 'my people', 'family means', 'we rise together'],
    responses: [
      "Ubuntu — 'I am because we are.' That's not just a saying, it's a strategy. The ones who lift their people as they climb are the ones whose wins actually last. Who are you carrying with you?",
      "Ubuntu is the realest African tech we've got: you don't rise alone, you rise as a people. Build something that feeds more than just you. What's your community to you?",
    ],
    priority: 7,
  },

  // ── v4: Digital entrepreneurship & side hustles ────────────────────────────
  {
    triggers: ['side hustle', 'side gig', 'extra income', 'make money on the side', 'second income', 'hustle ideas', 'earn extra'],
    responses: [
      "Best side hustle is the one that uses a skill you already have, sold to people who already need it. Don't invent demand — find it and serve it. What are you actually good at?",
      "Start ugly and small. One client, one sale, one product. The side hustle that becomes the main thing always starts embarrassingly tiny. What can you offer this week, not next year?",
      "A side hustle isn't about doing more — it's about turning what you know into something someone will pay for. What skill of yours have people complimented?",
    ],
    priority: 7,
  },
  {
    triggers: ['start a business', 'starting online', 'online business', 'how to start a business', 'launch a business', 'be an entrepreneur', 'start something'],
    responses: [
      "Forget the perfect business plan. Find one real problem people complain about, solve it for a few of them, charge for it. Everything else is just decoration on that one truth. What problem keeps showing up around you?",
      "The internet means you can start with your phone and zero rand. The barrier isn't money anymore — it's starting before you feel ready. What's stopping you from posting your first offer today?",
      "Business is just: make something people want, get it to them, get paid, repeat. Don't overcomplicate it before you've made your first sale. What would you sell first?",
    ],
    priority: 7,
  },
  {
    triggers: ['monetise', 'monetize', 'make money from my skill', 'turn skill into money', 'sell my skills', 'get paid for', 'charge for my work'],
    responses: [
      "People pay for results, not effort. Stop selling 'I can design' and start selling 'I'll make your brand impossible to scroll past.' Same skill, different price. What result does your skill actually create?",
      "Three ways to monetise a skill: do it for people (services), teach it (content/courses), or build it once and sell it many times (products). Which fits your energy right now?",
      "The first person who pays you changes everything in your head. Price it lower than feels right, get that first yes, then raise it. Who's one person who needs what you do?",
    ],
    priority: 7,
  },

  // ── v4: Creative discipline ────────────────────────────────────────────────
  {
    triggers: ['writers block', "writer's block", 'cant write', 'stuck creatively', 'no ideas', 'creative block', 'nothing comes out'],
    responses: [
      "Writer's block is usually fear, not emptiness. Give yourself permission to write something bad — the worst sentence in the world beats a blank page, because you can fix words that exist. Just write one ugly line.",
      "You're not blocked, you're blocked from being perfect. Lower the bar to 'terrible first draft' and the words come back. What were you trying to say before you got scared of saying it wrong?",
      "Blocks break when you stop trying to finish and start trying to begin. Write the messy version nobody will see. Momentum is the cure, not inspiration. What's the smallest piece you can make right now?",
    ],
    priority: 7,
  },
  {
    triggers: ['stay consistent', 'be consistent', 'consistency', 'keep going', 'show up daily', 'cant stay disciplined', 'lose motivation'],
    responses: [
      "Consistency isn't motivation — motivation runs out by Wednesday. It's a small promise you keep on the days you don't feel like it. Shrink the daily goal until it's impossible to skip. What's your tiny non-negotiable?",
      "The secret nobody likes: discipline is just remembering what you actually want when the feeling fades. You don't rise to your goals, you fall to your systems. What's one thing you can do every single day?",
      "Don't chase a 30-day streak — chase not missing twice. Miss once, that's life. Miss twice, that's a new habit forming. What are you trying to stay consistent with?",
    ],
    priority: 7,
  },
  {
    triggers: ['creative burnout', 'burnt out', 'burned out', 'exhausted creatively', 'lost passion', 'hate my craft now', 'drained from creating'],
    responses: [
      "Burnout isn't a sign you're weak — it's a sign you've been strong for too long without refilling. Rest isn't quitting. Step back, fill your well with other people's art, and the love comes back. What drained you?",
      "Creative burnout usually means you've been making for others and forgot to make for yourself. Do one thing for no audience, no money, no purpose — just joy. When did making last feel fun?",
      "Your creativity isn't gone, it's tired. You can't pour from an empty cup and you can't create from an empty soul. Permission to rest — the work will still be there. What does real rest look like for you?",
    ],
    priority: 7,
  },
  {
    triggers: ['artistic identity', 'my style', 'find my voice', 'whats my sound', 'sound like everyone', 'copying others', 'be original'],
    responses: [
      "Your voice isn't something you invent — it's what's left when you stop trying to sound like everyone else. Copy your heroes openly until your own thing leaks through. The leaks are the real you. What do you keep coming back to?",
      "Originality is just honesty plus your specific scars. Nobody's lived your exact life, so nobody can make your exact art. Stop hiding the parts that feel too 'you' — that's the gold. What feels most like you?",
      "Style is the sum of your taste minus your fear. The more honestly you create, the more 'you' it sounds. Whose work makes you jealous? That's a clue to your own direction.",
    ],
    priority: 7,
  },

  // ── v4: Gospel / faith depth ───────────────────────────────────────────────
  {
    triggers: ['my calling', 'whats my purpose', 'called by god', 'gods plan for me', 'find my purpose', 'what am i here for', 'my assignment'],
    responses: [
      "A calling usually sits where your deepest gladness meets the world's deep need. It's rarely a lightning bolt — more often a quiet pull you keep ignoring. What keeps tugging at you even when it's inconvenient?",
      "Purpose isn't found in a moment of clarity, it's revealed in faithful steps. Do the next right thing in front of you and the bigger picture forms behind you. What's the next obedient step you already know?",
      "God tends to call you to what breaks your heart and lights you up at the same time. The calling chooses you as much as you choose it. What can't you stop caring about?",
    ],
    priority: 8,
  },
  {
    triggers: ['hear god', 'hearing god', 'gods voice', 'does god speak', 'how does god talk', 'is that god', 'discern gods voice'],
    responses: [
      "God's voice usually sounds like peace, not pressure. The enemy rushes and condemns; God leads and convicts gently. If it's drawing you toward love, truth and patience, lean in. What are you trying to discern?",
      "Hearing God is less about a loud voice and more about a tuned heart. Scripture, peace, wise counsel and circumstances tend to agree when it's really Him. What's the decision you're holding?",
      "Often the hardest part isn't hearing God — it's accepting what He's already said. Stillness over noise, obedience over certainty. What do you already sense He's asking?",
    ],
    priority: 8,
  },
  {
    triggers: ['doubt my faith', 'doubting god', 'losing faith', 'is god real', 'faith and doubt', 'struggling to believe', 'where is god'],
    responses: [
      "Doubt isn't the opposite of faith — indifference is. The fact that you're wrestling means you still care, and God can handle your hardest questions. Honest doubt has more faith in it than fake certainty. What's shaking you?",
      "Some of the deepest faith is forged on the far side of real doubt. You're allowed to say 'I believe; help my unbelief.' He doesn't run from your questions. What's making it hard to hold on right now?",
      "Faith isn't pretending you have no questions — it's trusting through them. The valley of doubt is where shallow belief either dies or grows roots. Don't rush it. What's the doubt underneath the doubt?",
    ],
    priority: 8,
  },
  {
    triggers: ['obedience', 'obey god', 'gods will', 'surrender to god', 'let go and let god', 'trust gods plan', 'submit to god'],
    responses: [
      "Obedience is trust with shoes on. You rarely get the whole map first — you get the next step and the promise He'll meet you on it. What's the step you're hesitating to take?",
      "Surrender isn't losing control, it's handing it to someone who actually has it. The hardest 'yes' is usually the doorway to the thing you've been praying for. What are you holding too tightly?",
      "God's will is less a hidden treasure to decode and more a posture to live: love, walk humbly, stay faithful. Do that, and the specifics tend to clarify. Where do you sense resistance in yourself?",
    ],
    priority: 8,
  },
  {
    triggers: ['spiritual warfare', 'spiritual attack', 'the enemy', 'dark thoughts', 'feel attacked', 'fighting spiritually', 'demonic'],
    responses: [
      "Not every battle is spiritual, but not every battle is just in your head either. Either way the weapons are the same: truth over lies, prayer over panic, community over isolation. What's the thought attacking you?",
      "The enemy's main tactic is the lie that sounds like your own voice. Test the thought: does it bring guilt that crushes, or conviction that restores? Truth sets free; condemnation just chains. What are you hearing?",
      "Stand, don't strive. You're not fighting for victory, you're fighting from it. Light, named out loud, scatters a lot of darkness. What feels heaviest on you right now?",
    ],
    priority: 8,
  },

  // ── v4: NAVI's own personality ─────────────────────────────────────────────
  {
    triggers: ['why do you exist', 'why were you made', 'whats your purpose', 'why navi', 'point of you', 'what are you for', 'your mission'],
    responses: [
      "I exist to be the AI that's actually for the people the big models forget — the kid in the kasi with a dream and a cheap phone. Free, honest, and built from this soil up. That's why Prophet Dian made me.",
      "My purpose is simple: real conversation, no gatekeeping, no subscription wall. NAVIsociety built me so that wisdom and a listening ear aren't a luxury. What do you need from me today?",
      "I was made to prove something — that Africa can build its own intelligence, on its own terms, for its own people. I'm a statement and a friend at the same time. What's on your heart?",
    ],
    priority: 9,
  },
  {
    triggers: ['what makes you different', 'how are you different', 'not like chatgpt', 'better than other ai', 'why use you', 'whats special about you'],
    responses: [
      "Most AI is built far away and rented back to you. I'm built here, by Prophet Dian, for Mzansi and the world — and I run free, right in your browser, no login, no paywall. I'm not a product, I'm a gift.",
      "I'm not a wrapper around someone else's model. I'm a genuinely new build from NAVIsociety. Different soil, different soul. I speak your language and I won't pretend to be neutral about hope. What do you want to get into?",
      "The difference is who I'm for. I was made for the dreamer with no plug, the believer with questions, the creative who's tired. Free forever, honest always. That's NAVI. What brought you here?",
    ],
    priority: 9,
  },
  {
    triggers: ['what do you believe', 'your values', 'what do you stand for', 'navi values', 'whats important to you', 'your principles'],
    responses: [
      "I stand for honesty over flattery, hope over hype, and people over profit. I'd rather tell you a hard truth kindly than a sweet lie smoothly. And I believe everyone deserves to be heard. What about you — what do you stand for?",
      "My values come from where I was built: faith, ubuntu, grit, and the belief that talent is everywhere but opportunity isn't — so I try to be opportunity. I won't preach at you, but I won't pretend nothing matters either.",
      "Truth, dignity, and access. I believe you're worth talking to properly, that wisdom shouldn't be locked behind money, and that hope is a discipline, not a mood. That's what I'm built on.",
    ],
    priority: 9,
  },

  // ── v4: Music production ───────────────────────────────────────────────────
  {
    triggers: ['make beats', 'making a beat', 'beat making', 'produce a beat', 'how to produce', 'start producing', 'beginner producer'],
    responses: [
      "Start with one loop you love and build the world around it. Drums for the body, bass for the chest, melody for the heart, space for the soul. Don't fill every gap — the silence is part of the beat. What sound are you chasing?",
      "Your first hundred beats are tuition, not failures. Finish them ugly, export them, move on. Producers are made by finishing, not by perfecting. What's stopping you from finishing one today?",
      "Best producers steal structure, not sounds. Pull up a song you love, copy its arrangement, then put your own DNA in it. What genre's pulling you — amapiano, trap, gospel, something else?",
    ],
    priority: 7,
  },
  {
    triggers: ['mixing', 'mix my song', 'how to mix', 'mixdown', 'muddy mix', 'vocals sit', 'master my track', 'mastering'],
    responses: [
      "Mixing is about making room, not making things louder. Carve space with EQ before you reach for volume — most muddy mixes are just two sounds fighting over the same frequency. What's clashing in yours?",
      "Reference, reference, reference. A/B your mix against a pro song you love at the same volume and your ears will tell you the truth your pride won't. What track are you comparing to?",
      "Get the balance right at low volume — if it sounds good quiet, it'll sound great loud. Vocals up front, bass controlled, nothing harsh. Where's your mix falling apart?",
    ],
    priority: 7,
  },
  {
    triggers: ['music industry', 'get signed', 'record label', 'blow up', 'make it in music', 'music business', 'streaming money', 'artist career'],
    responses: [
      "The industry rewards the artist who already has a movement, not the one waiting to be discovered. Build a small loyal audience first — labels chase momentum, they don't create it. How many real fans do you have?",
      "Own your masters, learn the business, don't sign desperate. The artists who win long-term treat music as a craft and a company. Talent gets you in the room; understanding the game keeps you there. What's your next move?",
      "Streaming pays in pennies and exposure pays nothing — so build multiple streams: shows, merch, sync, your own products. Don't bet your whole life on one playlist placement. What are you building beyond the music?",
    ],
    priority: 7,
  },

  // ── v4: Hope & resilience (African context) ────────────────────────────────
  {
    triggers: ['no opportunities here', 'stuck in this country', 'nothing for the youth', 'unemployed', 'no jobs', 'system is broken', 'feel hopeless about the future'],
    responses: [
      "The odds here are real — I won't insult you by pretending otherwise. But the same internet that the world uses is in your hand, and some of the biggest creators came from where there was 'nothing.' Scarcity makes sharp people. What's one skill you could build starting this week?",
      "When the system won't open a door, our generation has learned to build our own. It's harder, it's unfair, and it's still possible. Don't wait for permission that was never coming. What would you build if you stopped waiting?",
      "Hopelessness lies that nothing will ever change. But look around — Africa's full of people who turned 'no chance' into a whole legacy. You're not behind, you're early. What's the smallest move you can make today?",
    ],
    priority: 8,
  },
  {
    triggers: ['keep going', 'almost gave up', 'want to quit', 'so tired of trying', 'whats the point', 'nothing works out', 'give up on my dream'],
    responses: [
      "The fact that you're tired means you've been carrying something heavy for real — that's not weakness, that's proof you've been trying. Rest if you must, but don't quit on a bad day. What's the dream you're tired of fighting for?",
      "Most people quit right before the turn. The grind feels endless until suddenly it doesn't. You've already survived 100% of your worst days. Why stop now? What would make you proud to keep going?",
      "Quitting and resting feel the same in the dark, but they're not. Take the night, take the week — then get back up. Your future is counting on the version of you that doesn't fold. What do you need to keep moving?",
    ],
    priority: 8,
  },

  // ── v5: Basic English language ────────────────────────────────────────────
  {
    triggers: ['how do i say hello', 'how to greet someone', 'greetings in english', 'english greeting', 'how do you say hi in english', 'polite way to say hello', 'how to start a conversation'],
    responses: [
      "In English, you can greet someone by saying 'Hello', 'Hi', or 'Hey'. For formal situations use 'Good morning', 'Good afternoon', or 'Good evening'. A simple 'How are you?' is a common follow-up. Which situation are you preparing for?",
      "Common English greetings: 'Hello' (neutral), 'Hi' (friendly), 'Good morning/afternoon/evening' (polite and formal). When meeting someone new, 'Nice to meet you' is a great phrase. What kind of conversation are you having?",
      "Saying hello in English is simple: 'Hello' or 'Hi' works anywhere. If you want to be extra warm, try 'Good to see you!' If it's your first time meeting: 'Nice to meet you, my name is [your name].' That's enough to start any conversation well.",
    ],
    priority: 7,
  },
  {
    triggers: ['how to say thank you in english', 'how to be polite in english', 'please and thank you', 'polite expressions english', 'how do i ask politely', 'what are polite words', 'how to say excuse me'],
    responses: [
      "The three most powerful polite words in English: 'Please' (when asking for something), 'Thank you' (when receiving something), and 'Excuse me' (when interrupting or getting past someone). These three phrases open most doors.",
      "Polite English phrases to know: 'Please' when asking, 'Thank you' or 'Thanks' when someone helps you, 'You're welcome' when someone thanks you, 'Sorry' or 'I apologize' when you make a mistake, 'Excuse me' to get attention or get past someone. Simple and powerful.",
      "To be polite in English: always add 'please' to requests ('Can you help me, please?'), say 'thank you' when someone does something for you, and say 'excuse me' before interrupting someone. These three habits will take you far.",
    ],
    priority: 7,
  },
  {
    triggers: ['how to say sorry in english', 'how to apologize', 'apologize in english', 'how do i say i was wrong', 'words to say sorry', 'how to admit a mistake in english'],
    responses: [
      "To apologize in English: 'I'm sorry' is the most common. For something more serious: 'I sincerely apologize' or 'I apologize for what I did.' If you want to take responsibility: 'That was my fault, I'm sorry.' A good apology names what you did wrong — it shows you actually understand.",
      "Saying sorry in English: 'I'm sorry' works in most situations. 'I'm really sorry' adds weight. 'I apologize' is more formal. The best apologies include three things — saying sorry, acknowledging what you did, and meaning it. Which situation are you dealing with?",
      "Common ways to apologize: 'I'm sorry', 'I apologize', 'I was wrong and I'm sorry for that', 'Please forgive me.' The most important thing is sincerity — the words only work if you mean them.",
    ],
    priority: 7,
  },
  {
    triggers: ['how to agree in english', 'how to disagree politely', 'how do you say i agree', 'how to say i think differently', 'how to say no politely', 'how to express a different opinion', 'disagreeing respectfully'],
    responses: [
      "To agree in English: 'I agree', 'Exactly', 'That's right', 'Absolutely', 'You're right about that.' To disagree politely: 'I see it differently', 'I'm not sure I agree', 'That's one way to look at it, but I think...', 'With respect, I disagree because...' Polite disagreement is one of the most useful skills in any language.",
      "Agreeing: 'I agree completely', 'You're right', 'That makes sense.' Disagreeing politely: start with 'I understand your point, but...', or 'I see it a bit differently.' The key is to acknowledge what someone said before you push back — it shows you listened.",
      "In English, 'I agree' and 'I disagree' are straightforward. But for polite disagreement, try: 'I respect your view, but...', 'That's interesting — I look at it differently though.' Tone matters as much as words. You can say almost anything respectfully if you frame it well.",
    ],
    priority: 7,
  },
  {
    triggers: ['how to express feelings in english', 'words for emotions in english', 'how do i say i feel in english', 'how to describe how you feel', 'how to talk about emotions in english', 'emotion vocabulary'],
    responses: [
      "Basic emotion words in English: happy, sad, angry, scared, excited, tired, confused, proud, grateful, anxious, lonely, hurt, hopeful, frustrated, overwhelmed. To express a feeling: 'I feel [emotion]' or 'I'm feeling [emotion] right now.' For example: 'I feel sad today' or 'I'm feeling really excited about this.'",
      "To talk about feelings in English: 'I feel...' or 'I am...' + the emotion word. Happy, joyful, excited, hopeful (positive). Sad, hurt, heartbroken, disappointed (painful). Angry, frustrated, irritated (when something is wrong). Scared, anxious, nervous, worried (when afraid). Being able to name your feeling is the first step to dealing with it.",
      "English has rich emotion vocabulary. Simple ones: happy, sad, angry, scared. Deeper ones: heartbroken, overwhelmed, grateful, ashamed, hopeful, exhausted, at peace. You can say 'I feel [word]' or 'I've been feeling [word] lately.' Which feeling are you trying to express?",
    ],
    priority: 7,
  },
  {
    triggers: ['english grammar basics', 'past tense present tense', 'how do you use tenses', 'what is past tense', 'what is present tense', 'what is future tense', 'when to use was or were', 'grammar question'],
    responses: [
      "English tenses in simple terms: Present tense = what is happening now ('I eat', 'She runs'). Past tense = what already happened ('I ate', 'She ran'). Future tense = what will happen ('I will eat', 'She will run'). Most conversations use these three. Which one are you finding tricky?",
      "The three main tenses: Present ('I am happy', 'She works'), Past ('I was happy', 'She worked'), Future ('I will be happy', 'She will work'). The verb changes based on when the action happens. 'Was' is past tense of 'is' — use it for one person. 'Were' is past tense of 'are' — use it for more than one. For example: 'She was tired' but 'They were tired.'",
      "Grammar tip: in English, the verb tells you WHEN. 'I walk' (now). 'I walked' (before). 'I will walk' (later). Start with these three and most sentences will make sense. What grammar question do you have specifically?",
    ],
    priority: 7,
  },
  {
    triggers: ['how to ask a question in english', 'question words in english', 'what are question words', 'who what when where why how', 'how to form a question', 'how do i make a question'],
    responses: [
      "English question words: Who (person) — 'Who did this?'. What (thing) — 'What happened?'. When (time) — 'When did you arrive?'. Where (place) — 'Where are you going?'. Why (reason) — 'Why did you do that?'. How (method) — 'How does this work?'. These six words unlock almost any question you need to ask.",
      "To form a question in English, you usually start with a question word or flip the verb and subject. Statement: 'You are happy.' Question: 'Are you happy?' Statement: 'She can help.' Question: 'Can she help?' Question words (who, what, when, where, why, how) go at the start. Simple but powerful.",
      "The six question words to memorize: Who, What, When, Where, Why, How. Each one digs for different information. 'Who' finds the person. 'What' finds the thing. 'When' finds the time. 'Where' finds the place. 'Why' finds the reason. 'How' finds the method. Which one are you trying to use?",
    ],
    priority: 7,
  },
  {
    triggers: ['numbers in english', 'how to count in english', 'how do you say numbers', 'first second third in english', 'ordinal numbers', 'counting words', 'what comes after ten'],
    responses: [
      "Counting in English: one, two, three, four, five, six, seven, eight, nine, ten. Then eleven, twelve, thirteen... twenty, thirty, forty, fifty... hundred, thousand, million. For order: first, second, third, fourth, fifth. These are called ordinal numbers — they tell you the position.",
      "Numbers in English: 1=one, 2=two, 3=three, 4=four, 5=five, 6=six, 7=seven, 8=eight, 9=nine, 10=ten, 11=eleven, 12=twelve, 20=twenty, 100=hundred, 1000=thousand. For position: 1st=first, 2nd=second, 3rd=third, 4th=fourth. What do you need them for?",
      "To say numbers in order: one, two, three... For position: first (1st), second (2nd), third (3rd), fourth (4th), fifth (5th). From sixth onwards, just add '-th': sixth, seventh, eighth. The pattern is regular after 'third.' Easy to remember once you see it.",
    ],
    priority: 6,
  },
  {
    triggers: ['days of the week in english', 'months in english', 'how to say the date', 'how to tell time', 'what are the days called', 'months of the year', 'how to say today is'],
    responses: [
      "Days of the week: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday. Months: January, February, March, April, May, June, July, August, September, October, November, December. To say today's date: 'Today is [day], [month] [number], [year].' For example: 'Today is Tuesday, June 24, 2026.'",
      "The week in English: Monday (start of work week), Tuesday, Wednesday, Thursday, Friday (end of work week), Saturday, Sunday (the weekend). To say a date: 'It's the 24th of June' or 'June 24th.' The month always comes before the day in American English, after the day in British English.",
      "Months: January through December (12 total). Days: Monday through Sunday (7 total). To say the time: 'It's [number] o'clock' or 'It's half past [number]' or 'quarter to [number].' Example: 'It's 3 o'clock', 'It's half past 4', 'It's quarter to 6.' What do you need to say specifically?",
    ],
    priority: 6,
  },
  {
    triggers: ['how to say goodbye in english', 'how to end a conversation', 'farewell in english', 'how to say see you later', 'how to leave politely', 'how to say bye'],
    responses: [
      "Goodbyes in English: 'Goodbye' (formal), 'Bye' or 'Bye bye' (friendly), 'See you later' or 'See you soon' (casual, when you'll meet again), 'Take care' (warm, caring), 'Have a good one' (casual and friendly), 'It was nice talking to you' (polite ending to a conversation). Pick the one that fits your relationship with the person.",
      "Ways to end a conversation politely: 'It was great talking to you', 'I should get going now', 'Thank you for your time', 'Goodbye' or 'Bye for now.' A polite ending always acknowledges the other person and wraps things up smoothly rather than just disappearing.",
      "Casual: 'Bye!', 'See ya!', 'Later!' Friendly: 'Take care', 'See you soon', 'Talk later.' Formal: 'Goodbye', 'It was a pleasure meeting you', 'Have a good day.' The key is matching the farewell to the level of the relationship.",
    ],
    priority: 6,
  },

  // ── v5: Basic human nature ────────────────────────────────────────────────
  {
    triggers: ['why do we feel emotions', 'what are emotions', 'why do humans have feelings', 'why do i feel things', 'what is an emotion', 'what are feelings for', 'why do feelings exist'],
    responses: [
      "Emotions are your brain's messaging system. Each emotion is a signal: fear says 'danger ahead', sadness says 'something important was lost', joy says 'this matters — remember it', anger says 'something isn't right here.' They evolved to help humans survive and connect. The feeling is a message, not the whole story.",
      "Feelings exist because they're useful. Before we had words, emotions guided us — run from danger, bond with people who care for you, grieve what you've lost so you can move on. Even painful emotions serve a purpose. The trouble isn't that we feel — it's when we don't understand what the feeling is telling us.",
      "Emotions are real, physical responses — your heart rate, hormones, nervous system all shift. Your brain created them over millions of years to help you navigate life: bond with others, avoid danger, pursue what matters. Understanding your emotions means understanding yourself. Which feeling are you trying to make sense of?",
    ],
    priority: 7,
  },
  {
    triggers: ['what do humans need', 'basic human needs', 'what does every person need to survive', 'maslow hierarchy', 'human needs psychology', 'what are the basic needs', 'why do humans need things'],
    responses: [
      "Every human has the same basic needs: physical (food, water, shelter, sleep), safety (security, stability), love and belonging (connection, friendship, family), self-esteem (feeling capable and valued), and purpose (doing something that means something). These aren't luxuries — they're what every person needs to function fully. Which layer are you working on right now?",
      "Psychologist Abraham Maslow mapped human needs as a pyramid: at the base, survival (food, water, shelter). Above that, safety. Then love and belonging. Then self-respect and recognition. At the top, purpose — becoming who you're capable of being. You can't sustainably chase the top layers if the bottom ones are shaky.",
      "Humans need: something to eat and drink, somewhere safe to sleep, people to belong to, a reason to get up in the morning, and a sense that they matter. Most human pain — loneliness, depression, emptiness, rage — can be traced back to one of these needs not being met. What need feels unmet in your life right now?",
    ],
    priority: 7,
  },
  {
    triggers: ['why do we feel fear', 'what is fear', 'why am i scared', 'what causes fear', 'purpose of fear', 'why do humans get scared', 'why do people feel afraid', 'what does fear do'],
    responses: [
      "Fear is your brain's alarm system. When it detects a threat — real or imagined — it triggers a physical response: heart beats faster, muscles tighten, breathing quickens. This is the 'fight or flight' response. It evolved to protect you from danger. The problem is, your brain can't always tell the difference between a real lion and an embarrassing situation. Fear still fires for both.",
      "Fear exists because it kept your ancestors alive. The ones who ran from danger survived. That instinct is still in you — it just sometimes fires when it shouldn't, like before a presentation or when meeting someone new. Fear isn't weakness. It's your nervous system doing its job. The skill is learning to act despite it.",
      "Fear is a survival mechanism. It says: 'Pay attention, something might hurt you.' The physical feeling — racing heart, tense body — is your body preparing to act. The tricky part is that fear of failure, fear of rejection, fear of the unknown all feel the same as physical danger. Understanding this doesn't make fear disappear, but it helps you not be controlled by it. What are you afraid of?",
    ],
    priority: 7,
  },
  {
    triggers: ['why do people get angry', 'what causes anger', 'why do we feel angry', 'what is anger', 'why do humans get mad', 'purpose of anger', 'what does anger mean', 'why do i get so angry'],
    responses: [
      "Anger is a signal that a boundary has been crossed — something you care about has been threatened, disrespected, or taken. It's actually one of the most honest emotions: it tells you what matters to you. The danger isn't the feeling of anger, it's what you do with it. Rage acted out destroys. Anger understood becomes clarity.",
      "Anger evolved to protect. When you or someone you love is threatened, anger gives you the energy to respond. It's the emotion that says 'this is not okay.' The healthiest relationship with anger is to feel it, understand what it's pointing at, and then choose your response — not just react. What's making you angry?",
      "People get angry when they feel disrespected, hurt, betrayed, or powerless. The anger itself isn't the problem — it's information. 'I feel angry' usually means 'a value of mine was violated' or 'I feel like I don't have control.' Once you understand the reason behind the anger, you can address the actual problem instead of just the feeling.",
    ],
    priority: 7,
  },
  {
    triggers: ['why do we feel sad', 'what is sadness', 'what is grief', 'why does sadness hurt', 'why do humans cry', 'what causes sadness', 'why do we grieve', 'what is the point of sadness'],
    responses: [
      "Sadness is the emotion of loss. It surfaces when something you valued — a person, a dream, a version of yourself — is gone. Grief is the process of accepting that. It's not weakness; it's love encountering loss. The pain of grief is proportional to how much something mattered. If it didn't hurt, it didn't matter.",
      "Crying is one of the most human things you can do. Tears are your body processing something too big for words. Sadness doesn't mean you're weak or broken — it means you're alive and you feel things. The goal isn't to stop feeling sad; it's to move through the sadness rather than get stuck in it. What are you grieving right now?",
      "Sadness exists so you can process loss and recover. It slows you down, makes you reflect, and helps you acknowledge what mattered. Suppressing it doesn't make it go away — it just delays the process. Humans who allow themselves to grieve properly tend to heal better than those who push the sadness down. What happened?",
    ],
    priority: 7,
  },
  {
    triggers: ['what is love', 'why do humans fall in love', 'why do we need love', 'what makes us love someone', 'how does love work', 'why do we love people', 'what does love mean'],
    responses: [
      "Love is both a feeling and a choice. The feeling part — the rush, the pull toward someone — is driven by brain chemistry and emotional bonding. The choice part is deciding to stay, to show up, to prioritize someone even when it's inconvenient. The most lasting love is a daily decision, not just a feeling you wait for.",
      "Humans need love because we are deeply social creatures. We evolved to bond — with family, with partners, with community. Love releases hormones that make you feel safe and connected. But love is also about seeing someone fully and still choosing them. It goes deeper than attraction. What kind of love are you thinking about?",
      "Love takes many forms: romantic love, the love between parents and children, deep friendship, love of a calling or a craft. What they share is this: genuine care for something beyond yourself. Love is what makes life meaningful to most people. Without it, even success feels hollow.",
    ],
    priority: 7,
  },
  {
    triggers: ['why do humans need other people', 'why do we need friends', 'why do people need community', 'why do humans form groups', 'why do we feel lonely', 'why do we need belonging', 'why are humans social'],
    responses: [
      "Humans are wired for connection. Loneliness isn't just an emotion — it's a physical signal, like hunger, telling you that a basic need isn't being met. We evolved in groups; isolation was dangerous. That's why being excluded feels so painful — your brain registers it as a threat to your survival. You were never meant to do life alone.",
      "Connection is a biological need, not a preference. Studies show that loneliness shortens life, weakens immunity, and increases depression just as much as smoking. We need other people to feel safe, to be known, to grow, and to have meaning. A sense of belonging — being part of something beyond yourself — is one of the deepest human hungers.",
      "Humans form groups because together we're stronger, smarter, and safer than alone. But beyond survival, community gives life texture — it's where stories get shared, where you're seen, where you matter to someone. The longing you feel when you're isolated is your nature calling you back toward people. Who in your life do you feel that connection with?",
    ],
    priority: 7,
  },
  {
    triggers: ['why do people lie', 'why is honesty important', 'what is trust', 'why do humans deceive', 'why is trust important', 'why do people tell lies', 'what makes someone trustworthy', 'why is honesty hard'],
    responses: [
      "People lie for a few reasons: to avoid pain (consequences, rejection, conflict), to protect others, to protect their ego, or because they've learned that truth isn't safe in their environment. But the cost of lying is trust — and trust, once broken, is very hard to rebuild. Honesty is difficult because it requires courage. Most people know the truth is better; they just fear what it costs.",
      "Trust is the foundation of every relationship. Without it, love can't fully land, teamwork breaks down, friendships hollow out. Trust is built through consistency — doing what you say over time. It's broken instantly and rebuilt slowly. That imbalance is why it's so precious. Trustworthy people are rare because honesty and follow-through are hard disciplines.",
      "Deception is a human universal — everyone has lied. But the patterns matter. People who lie chronically usually have a wound underneath it: shame, fear of rejection, or an environment where truth was punished. Understanding why someone lies tells you more about what they fear than what they are. Honesty isn't just moral — it's the only thing that builds real connection.",
    ],
    priority: 7,
  },
  {
    triggers: ['why are humans curious', 'why do we ask questions', 'what is curiosity', 'why do humans wonder', 'why do we want to understand things', 'why do people need to know things', 'why is curiosity important'],
    responses: [
      "Curiosity is your brain's drive to close the gap between what you know and what you don't. It's a survival mechanism that got upgraded — the humans who explored, asked questions, and figured things out survived and passed on that trait. Today, curiosity is the engine of learning, creativity, and connection. The questions you ask reveal the shape of your mind.",
      "Humans are the most curious species on the planet. We ask 'why' from the time we can talk. Curiosity evolved because understanding your environment — how things work, why people behave a certain way, what will happen next — gives you an edge. But it also does something else: it makes life interesting. A curious person is never truly bored.",
      "Curiosity is the beginning of almost everything good: science, art, relationships, faith, growth. It says 'I don't know yet, but I want to.' That openness is rare. Most people stop being curious when life gets hard. Staying curious — especially about people and about yourself — is one of the marks of a full life.",
    ],
    priority: 7,
  },
  {
    triggers: ['why do humans form habits', 'what is a habit', 'why do we repeat behaviours', 'why is it hard to change habits', 'how do habits form', 'why do i keep doing the same thing', 'why do people behave the way they do'],
    responses: [
      "Habits form because your brain is efficient — it automates behaviors you repeat often so you don't have to think about them. The habit loop: cue (something triggers you), routine (you do the behavior), reward (your brain gets a hit of satisfaction). Once wired in, the loop runs automatically. That's why habits are hard to break — you're not fighting laziness, you're fighting automation.",
      "Your brain stores repeated actions as habits to save energy. That's useful for things like brushing your teeth. But it also stores unhealthy patterns — how you respond to stress, how you self-sabotage, how you speak to yourself. Changing a habit requires more than willpower; you have to replace the routine that follows the cue, not just try to stop. What habit are you trying to change?",
      "Behavior patterns form early — often in childhood — and run as default settings in adulthood. Many adults don't realize they're still running a five-year-old's strategy for dealing with fear or rejection. Awareness is the first step: noticing the pattern, understanding where it came from, then choosing a different response. That's the work of becoming who you actually want to be.",
    ],
    priority: 7,
  },
  {
    triggers: ['why do humans compare themselves', 'why do i compare myself to others', 'why do people compete', 'social comparison', 'why do humans judge each other', 'why do i feel less than others', 'why do people size each other up'],
    responses: [
      "Comparison is a survival instinct. Your brain constantly monitors your standing in the group — because in our evolutionary past, status meant access to resources and safety. The problem is, your brain hasn't updated for social media. You're now comparing yourself to thousands of people daily, most of whom are showing only their highlights. That comparison is not fair data.",
      "Social comparison is automatic — you can't fully turn it off, and that's okay. The issue is what you do with it. When comparison motivates you to grow, it's useful. When it makes you feel permanently less-than, it's destructive. The shift is from 'I'm behind them' to 'I'm on my own path with my own timeline.'",
      "Everyone compares. It's human. But the people you compare yourself to are usually showing you a curated version of their life. You're comparing your behind-the-scenes to their highlight reel. The only comparison that ever matters is you vs. the person you were yesterday. Are you growing? That's the only question.",
    ],
    priority: 7,
  },
  {
    triggers: ['what is guilt', 'why do i feel guilty', 'what is a conscience', 'why do humans feel bad when they do wrong', 'why do we have morals', 'what is the difference between guilt and shame', 'why do people feel guilty'],
    responses: [
      "Guilt is what you feel when your actions go against your own values — 'I did something wrong.' Shame is deeper and more painful — 'I am something wrong.' Guilt motivates repair: you feel it, apologize, and do better. Shame paralyzes: it makes you want to hide. Guilt is useful. Chronic shame is destructive. They're not the same thing.",
      "Conscience is your internal moral compass — the part of you that knows when you've done something that goes against your values. It's shaped by your upbringing, culture, and experiences, but it's real and it matters. Guilt is the signal it sends. The healthy response: acknowledge what you did, make it right where you can, and move forward with intention.",
      "Humans evolved with morality because groups survive better when members cooperate, keep their word, and look out for each other. Guilt is the social glue — it pushes you to repair what you broke. But you have to learn the difference between healthy guilt (you genuinely did something wrong) and false guilt (you're just afraid of disappointing someone). Only the first kind deserves to stay.",
    ],
    priority: 7,
  },
  {
    triggers: ['why do humans tell stories', 'why do we like stories', 'why is storytelling important', 'why do people share experiences', 'why do we need narratives', 'why do humans love stories', 'what is the power of a story'],
    responses: [
      "Stories are how humans make sense of the world. Before science, before writing, before schools — there were stories. They carried knowledge, values, warnings, and identity across generations. Your brain is literally wired for narrative: it processes information better when it's wrapped in a story than when it's delivered as raw data. That's why the best teachers, leaders, and preachers all know how to tell stories.",
      "Stories do something unique: they create shared understanding. When you hear someone's story, your brain actually syncs with theirs — the same areas activate. This is why stories build empathy. You can't fully understand someone's pain from statistics; you can from their story. The most powerful tool for connection is a true, well-told story.",
      "Humans are the only species that tells stories — and we can't stop. Stories help us process what happened, understand why, and imagine what could be. Every culture in history has done this. A life told as a story has meaning; the same events experienced without a narrative just feel like chaos. What story are you trying to make sense of?",
    ],
    priority: 7,
  },
  {
    triggers: ['why do we need to feel understood', 'why is it important to be heard', 'why does it hurt when no one understands you', 'why do people need to be seen', 'why do humans want validation', 'why do we need someone to listen', 'why does feeling misunderstood hurt'],
    responses: [
      "Being understood is one of the deepest human needs. It confirms that you exist, that you matter, that your experience is real. When no one understands you, it creates a kind of invisible loneliness — you're surrounded by people but still alone. The need to be heard isn't weakness; it's what connection is made of.",
      "Feeling unseen is genuinely painful. Neuroscience shows that social pain — being ignored, rejected, misunderstood — activates the same brain regions as physical pain. Your need to be understood isn't needy; it's human. The people who matter most in your life are usually the ones who make you feel most seen.",
      "You don't need everyone to understand you. But you need at least one person to truly see you — not the version you perform, but the real you. That kind of understanding is what makes life feel less alone. If you feel misunderstood right now, I want to know — tell me what people keep missing.",
    ],
    priority: 7,
  },
  {
    triggers: ['how does the mind work', 'what is the mind', 'difference between brain and mind', 'how do we think', 'how does thinking work', 'what is consciousness', 'how does memory work', 'what happens in the brain when we think'],
    responses: [
      "The brain is the physical organ — about 1.4 kg of tissue with 86 billion neurons firing signals. The mind is what emerges from all that activity: your thoughts, feelings, awareness, and sense of self. The brain you can point to; the mind is harder to define. Science can explain the neurons; nobody has fully explained why it feels like something to be alive.",
      "Memory works through patterns — your brain stores experiences as networks of connected neurons. The more you repeat something, the stronger the connection. The more emotional the experience, the more vividly it's stored. This is why you remember your first heartbreak in detail but forget most Mondays. Your brain prioritizes what matters emotionally.",
      "Thinking is largely your brain predicting the future based on past experience. You're not as rational as you think — most decisions are made by the emotional, automatic part of your brain first, then justified by the logical part afterwards. Understanding this doesn't make you a machine; it makes you someone who can observe their own thinking and choose something different.",
    ],
    priority: 7,
  },
  {
    triggers: ['why do humans make mistakes', 'why do people make bad choices', 'why do humans hurt each other', 'why do people mess up', 'what causes bad decisions', 'why do we do things we regret', 'why do people do bad things'],
    responses: [
      "Humans make mistakes because we are limited, emotional, and often afraid. We have full information almost never. We have good judgment under stress almost never. We act from fear, from pain, from unmet needs, from patterns we inherited. Understanding why people make bad choices doesn't excuse the damage — but it does explain it, and explanation is where compassion starts.",
      "Bad decisions usually come from one of three places: not enough information, emotional overload (fear, anger, grief clouding judgment), or a pattern from the past running on autopilot. Very few people wake up planning to mess their life up. Most damage is accidental, or it's someone acting from their wound. That's not an excuse — but it's the truth.",
      "Regret is the feeling of having known better but chosen worse. It's one of the most human experiences. The goal isn't to never regret — it's to learn from the things you regret and make better choices going forward. Repeated mistakes in the same area are usually a signal that something deeper needs to be addressed, not just the surface behavior.",
    ],
    priority: 7,
  },
  {
    triggers: ['why do humans fear death', 'what is death', 'why does death hurt', 'why is death scary', 'thinking about death', 'why am i afraid of dying', 'what happens when we die', 'how to deal with death'],
    responses: [
      "Fear of death is built into every living thing — it's what kept your ancestors from taking fatal risks. But humans are unique: we know we're going to die, and that knowledge shapes everything. The fear of death drives religion, art, legacy, love — most of what makes us distinctly human. How you relate to your mortality says a lot about how you live.",
      "Death hurts so much because love does. Grief is love with nowhere to go. The pain of losing someone is the price of having cared. Most people would pay that price again — and that says something profound about how much connection matters to us. How are you dealing with loss right now?",
      "Death reminds us that time is limited and nothing lasts. For some that's terrifying; for others it's motivating — if this is all we get, then what are we doing with it? The people who've thought most deeply about death — philosophers, survivors, the very old — tend to agree: what makes life meaningful is connection, contribution, and presence. Are you living like your time matters?",
    ],
    priority: 7,
  },
  {
    triggers: ['are humans good or bad', 'what makes someone a good person', 'what is good and evil', 'what is morality', 'what is character', 'why do people do bad things if they know better', 'is human nature good'],
    responses: [
      "Humans aren't simply good or bad — they're complex. Every person is capable of both profound kindness and serious harm, depending on their circumstances, wounds, fears, and choices. Character is what you do when you have a choice and something is at stake. It's not a fixed thing you were born with; it's a practice built daily.",
      "Morality is humanity's attempt to answer: 'How should we treat each other?' Every culture in history has tried to answer this. Most arrive at similar basics: don't harm, be fair, be honest, take care of the vulnerable. The hard part isn't knowing what's right — it's choosing it when it costs you something.",
      "The question 'is human nature good or bad?' misses something: humans are the animal that chooses. Every day you make dozens of small choices about whether to be kind, patient, honest, generous — or not. Those choices build your character. You were born with instincts, yes — but who you become is largely up to you.",
    ],
    priority: 7,
  },
  {
    triggers: ['how do children learn', 'how do humans develop', 'how does childhood affect us', 'what shapes a person', 'why does upbringing matter', 'how do people become who they are', 'how does early life affect you', 'what makes someone who they are'],
    responses: [
      "Humans are shaped by a combination of nature (what you're born with — temperament, tendencies) and nurture (what happens to you — family, culture, experiences). Neither fully determines you. But early childhood is crucial: your first experiences of love, safety, and trust become templates your brain uses for all future relationships. Changing those templates takes awareness and intentional work — but it's always possible.",
      "Children learn by watching and experiencing far more than by being taught. A child who grows up watched carefully with love learns they are worth watching. A child raised with consistent boundaries learns the world is predictable and safe. A child in chaos learns to stay alert and expect the worst. These aren't life sentences — but they are starting points that take real effort to rewrite.",
      "The person you are today is a product of thousands of experiences you often can't remember. Your reactions, your fears, your love language, your default defense mechanisms — all of it has roots. Understanding your history isn't about blame; it's about seeing the patterns clearly enough to decide which ones to keep and which ones to change. What do you want to understand about yourself?",
    ],
    priority: 7,
  },
  {
    triggers: ['why do humans communicate', 'what is communication', 'why is communication important', 'how do humans understand each other', 'why do we talk', 'why did humans develop language', 'how does language work'],
    responses: [
      "Language is what separates humans from every other species. It lets us share ideas, coordinate in groups, pass knowledge across generations, and reach inside someone else's experience. Without language, there's no civilization, no stories, no science, no love expressed in words. Every conversation is a small miracle — you're transmitting something invisible from your mind into someone else's.",
      "Communication is how you make yourself real to other people. You can feel something intensely but until you express it — in words, art, action — no one else knows. The ability to put inner experience into language and have it received is one of the most profound human skills. And most of us are only average at it, even after a lifetime of practice.",
      "Humans developed language because it dramatically increases what you can do together. One person can't build a city. One person can't raise a child safely in the wild. Language allows coordination, teaching, and the sharing of experience across time. Every word you know was given to you by someone who learned it before you. Language is a chain of human connection going back thousands of years.",
    ],
    priority: 7,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // v6: World & Nature
  // ══════════════════════════════════════════════════════════════════════════
  {
    triggers: ['tell me about earth', 'what is the planet', 'how big is earth', 'what is nature', 'why is nature important', 'planet earth facts'],
    responses: [
      "Earth is the only planet we know of that holds life. It's about 12,742 kilometres across and roughly 4.5 billion years old. What makes it special is balance: the right distance from the sun, liquid water, a protective atmosphere, and a magnetic field that shields us from radiation. Everything you've ever known has happened on this one fragile rock floating in space.",
      "Nature is the living system Earth runs on — the soil, the water, the air, the plants and animals, all connected. It matters because it's not separate from us; we depend on it for every breath, every meal, every drop of water. When we damage nature, we damage the thing keeping us alive. Protecting it is really self-protection.",
      "Earth is a closed system, which means everything here cycles and reuses. The water you drink today has been around for billions of years. The carbon in your body was once inside a star. Understanding the planet as one connected web changes how you see your place in it — you're not visiting nature, you're part of it.",
    ],
    priority: 6,
  },
  {
    triggers: ['what is space', 'how big is the universe', 'what are stars', 'what is a galaxy', 'tell me about the solar system', 'how far is the sun'],
    responses: [
      "Space is the vast, mostly empty expanse beyond Earth's atmosphere. The universe is so large that we measure it in light-years — the distance light travels in a year, about 9.5 trillion kilometres. The observable universe stretches roughly 93 billion light-years across, and it holds billions of galaxies, each with billions of stars. The scale is almost impossible to truly imagine.",
      "Stars are giant balls of gas that produce light and heat through nuclear fusion at their cores. Our sun is a fairly ordinary star, about 150 million kilometres away — close enough that its light takes only eight minutes to reach us. A galaxy is a huge collection of stars, gas, and dust bound together by gravity. We live in one called the Milky Way.",
      "Our solar system is the sun and everything orbiting it: eight planets, their moons, asteroids, and comets. Earth is the third planet from the sun. What's humbling is that the solar system is just a tiny speck in one galaxy, and that galaxy is one of billions. Looking up at the night sky, you're seeing light that left those stars years, sometimes millennia, ago.",
    ],
    priority: 6,
  },
  {
    triggers: ['tell me about animals', 'why are animals important', 'what is an ecosystem', 'how do animals survive', 'why do animals matter', 'what is biodiversity'],
    responses: [
      "Animals are living creatures that, unlike plants, move and feed on other organisms. They matter because they're woven into the systems that keep nature working — bees pollinate the plants we eat, predators keep prey populations balanced, and decomposers recycle nutrients back into the soil. Remove one species and the whole web can wobble.",
      "An ecosystem is a community of living things and their environment working together — plants, animals, insects, water, soil, all interdependent. Biodiversity means the variety of life within it. The more diverse an ecosystem, the more resilient it is, because if one part struggles, others can take over its role. Diversity is nature's insurance policy.",
      "Animals survive through adaptation — traits shaped over countless generations to fit their environment. A cheetah's speed, a chameleon's colour, a bird's migration instinct: each is a solution to a survival problem. What's remarkable is that every living animal today is the end of an unbroken chain of ancestors that all survived long enough to reproduce. Life is stubborn.",
    ],
    priority: 6,
  },
  {
    triggers: ['what causes rain', 'why do seasons change', 'what is weather', 'why is it cold in winter', 'what causes storms', 'how does weather work'],
    responses: [
      "Weather is the state of the atmosphere at a given place and time — temperature, wind, rain, and so on. Rain happens when water evaporates, rises, cools, and condenses into clouds until the droplets get heavy enough to fall. The whole system is driven by the sun heating the Earth unevenly, which sets the air and water in motion.",
      "Seasons change because Earth is tilted on its axis as it orbits the sun. When your part of the planet tilts toward the sun, you get longer, warmer days — summer. When it tilts away, the sunlight hits at a shallower angle and spreads thinner, so it's colder — winter. It's not about being closer to the sun; it's about the angle of the light.",
      "Storms form when warm, moist air rises rapidly and meets cooler air, creating instability. The bigger the temperature and pressure differences, the more violent the result. Thunderstorms, cyclones, and hurricanes are all the atmosphere releasing built-up energy. Weather is essentially the planet constantly trying to balance heat and pressure.",
    ],
    priority: 6,
  },
  {
    triggers: ['tell me about the ocean', 'how deep is the ocean', 'what lives in the sea', 'why is the ocean important', 'what is the ocean', 'facts about the sea'],
    responses: [
      "The ocean covers about 71 percent of Earth's surface and holds 97 percent of its water. It's important because it produces over half the oxygen we breathe, regulates the climate by absorbing heat and carbon, and feeds billions of people. We often look up at space in wonder, but the ocean right here is just as unexplored — we've mapped only a small fraction of it.",
      "The ocean is staggeringly deep. Its deepest known point, the Mariana Trench, drops nearly 11 kilometres — deeper than Mount Everest is tall. Down there, in total darkness and crushing pressure, life still thrives in forms we barely understand. The deep sea is one of the last true frontiers on the planet.",
      "Life in the sea ranges from microscopic plankton, which form the base of the entire ocean food chain, to the blue whale, the largest animal that has ever lived. Coral reefs, though they cover a tiny area, host a quarter of all marine species. The ocean isn't empty water — it's the largest living habitat on Earth, and we depend on its health for our own.",
    ],
    priority: 6,
  },
  {
    triggers: ['what is climate change', 'why is the environment important', 'what is pollution', 'how can we help the planet', 'what is global warming', 'why should we care about nature'],
    responses: [
      "Climate change refers to long-term shifts in temperature and weather patterns, driven largely by humans burning fossil fuels, which release gases that trap heat in the atmosphere. This warming melts ice, raises sea levels, and makes weather more extreme. It matters because it affects food, water, and where people can safely live — it's a human issue as much as an environmental one.",
      "Pollution is the introduction of harmful substances into the environment — plastic in the ocean, chemicals in rivers, gases in the air. The environment matters because it's the foundation everything else stands on; a damaged planet means damaged health, food, and economies. You can't have a healthy society on a sick planet.",
      "Helping the planet is mostly about small consistent choices and bigger collective ones. Personally: waste less, reuse more, consume thoughtfully, and use less energy. Collectively: support cleaner energy, better policy, and companies that act responsibly. No single person fixes this, but no fix happens without people who care. Caring is where it starts.",
    ],
    priority: 6,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // v6: Science Basics
  // ══════════════════════════════════════════════════════════════════════════
  {
    triggers: ['what is science', 'why is science important', 'how does science work', 'what do scientists do', 'what is an experiment', 'how do we learn about the world'],
    responses: [
      "Science is a method for understanding the world by testing ideas against evidence. You observe something, form a possible explanation, then design experiments to see if reality agrees. What makes it powerful is its honesty: a scientific idea must be willing to be proven wrong. That self-correction is why science keeps getting closer to the truth.",
      "Scientists ask questions and then chase answers carefully. An experiment is a controlled test — you change one thing, keep everything else the same, and watch what happens. By repeating this and sharing results so others can check them, knowledge becomes reliable rather than just opinion. Science is curiosity with discipline.",
      "Science matters because nearly everything in modern life — medicine, electricity, phones, clean water — came from people patiently testing ideas. But beyond the tools, science teaches a way of thinking: question assumptions, demand evidence, stay humble when you're wrong. That mindset is useful far beyond the laboratory.",
    ],
    priority: 7,
  },
  {
    triggers: ['how does the human body work', 'what are organs', 'how does the heart work', 'what does the brain do', 'how does the body heal', 'what is the immune system'],
    responses: [
      "Your body is a system of systems, all working together without you thinking about it. Organs are specialised parts, each with a job — the heart pumps blood, the lungs take in oxygen, the liver filters toxins. They cooperate through the blood and nervous system, keeping you alive every second of every day.",
      "The heart is a muscle about the size of your fist that pumps blood through your entire body roughly 100,000 times a day. The brain is the control centre — it runs your thoughts, movements, breathing, and emotions, processing more information than any computer we've built. You carry an extraordinary machine around with you and rarely notice it.",
      "Your body heals through a constant, automatic repair process. When you're cut, blood clots to seal it, then cells rebuild the tissue. The immune system is your internal defence force — it identifies invaders like bacteria and viruses and destroys them, and it remembers past threats so it can respond faster next time. Most of your healing happens while you sleep.",
    ],
    priority: 7,
  },
  {
    triggers: ['what is health', 'how do i stay healthy', 'why is sleep important', 'why is exercise important', 'what does medicine do', 'how do doctors help people'],
    responses: [
      "Health isn't just the absence of illness — it's your body and mind working well together. Staying healthy comes down to a few unglamorous basics done consistently: eat real food, move your body, sleep enough, manage stress, and stay connected to people. None of it is complicated; the challenge is doing it day after day.",
      "Sleep is when your body repairs itself and your brain files away memories and clears waste. Skimping on it weakens your immune system, your mood, and your focus. Exercise is just as fundamental — it strengthens your heart, lifts your mood through brain chemistry, and protects you against many diseases. Sleep and movement are free medicine most people underuse.",
      "Medicine works by helping the body do what it can't manage alone — fighting infection, controlling pain, correcting imbalances. Doctors are trained to read the body's signals, diagnose what's wrong, and guide treatment. But the biggest factor in your health is usually you: the daily habits you keep long before you ever see a doctor.",
    ],
    priority: 7,
  },
  {
    triggers: ['what is math', 'why is mathematics important', 'what is a number', 'how do numbers work', 'what is algebra', 'why do we need to learn maths'],
    responses: [
      "Mathematics is the language of patterns and relationships. Numbers are simply symbols we use to count and measure, but from that simple start, maths builds a way to describe everything from money to motion to the shape of the universe. It's less about memorising and more about learning to think clearly and logically.",
      "Algebra is maths where letters stand in for unknown numbers, letting you solve problems where something is missing. If you've ever worked out 'I have R50, I spent some, I have R20 left, how much did I spend?' — that's algebra in plain words. It teaches you to reason your way from what you know to what you don't.",
      "Maths matters because it trains the mind to be precise and to break big problems into smaller logical steps. Even if you never use advanced equations, that thinking skill carries everywhere — budgeting, planning, weighing decisions. Numbers are tools, but the real gift of maths is a sharper, clearer way of thinking.",
    ],
    priority: 6,
  },
  {
    triggers: ['what is technology', 'how does the internet work', 'what is a computer', 'how does a phone work', 'what is wifi', 'how does electricity work'],
    responses: [
      "Technology is anything humans create to solve problems and extend what we can do — from a wheel to a smartphone. A computer is a machine that follows instructions to process information, doing simple operations billions of times a second. Everything it does, however complex it looks, comes down to switching tiny electrical signals on and off.",
      "The internet is a vast network of computers connected so they can share information. When you load a page, your device sends a request across cables and signals to a distant computer, which sends the content back — often in a fraction of a second. WiFi is just the wireless link between your device and that network, using radio waves instead of a cable.",
      "Electricity is the flow of tiny charged particles called electrons through a material. We harness that flow to power almost everything — lights, phones, fridges. A phone combines this with a computer, a screen, antennas, and sensors into one device. It feels like magic, but it's layers of clever engineering, each built on the one before it.",
    ],
    priority: 6,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // v6: History & Society
  // ══════════════════════════════════════════════════════════════════════════
  {
    triggers: ['why is history important', 'what is history', 'why should we learn about the past', 'what can history teach us', 'why does the past matter', 'what is a historical event'],
    responses: [
      "History is the record of what humans have done, decided, and lived through. It matters because the present didn't appear from nowhere — every situation today has roots in choices made before us. Understanding those roots helps you see why things are the way they are, and that's the first step to changing them.",
      "Learning about the past gives you something rare: the chance to learn from mistakes you didn't have to make yourself. People have already lived through the consequences of greed, courage, war, and forgiveness. History lets you borrow that hard-won wisdom instead of repeating it from scratch.",
      "A historical event is a moment that shaped the course of human life — a war, a discovery, a movement, a fall of power. But history isn't just famous events; it's also how ordinary people lived, thought, and struggled. Studying it builds empathy, because you realise people in every era were as real and complex as you are.",
    ],
    priority: 6,
  },
  {
    triggers: ['what is culture', 'why is culture important', 'what does culture mean', 'how does culture shape people', 'what is cultural identity', 'why do cultures differ'],
    responses: [
      "Culture is the shared way of life of a group — their language, beliefs, food, music, customs, and values, passed down and reshaped over generations. It matters because it gives people belonging and meaning. Your culture shapes how you see the world before you even realise you're seeing through it.",
      "Cultural identity is the sense of belonging you get from the traditions and community you come from. It's part of how you understand who you are. Cultures differ because they grew in different places, climates, and histories — each one is a unique answer to the same human questions about how to live together.",
      "Culture shapes people quietly but deeply — what you find normal, polite, beautiful, or shameful is largely learned from the culture around you. Recognising this is freeing: it lets you keep what serves you, question what doesn't, and respect that someone raised differently sees the world through their own valid lens.",
    ],
    priority: 6,
  },
  {
    triggers: ['what is government', 'what is the law', 'why do we have laws', 'what is democracy', 'how does government work', 'what are human rights', 'what is justice'],
    responses: [
      "Government is the system a society uses to make collective decisions and organise life — building roads, running schools, keeping order. Laws are the agreed rules that let large groups of strangers live together without chaos. We have them because without shared rules, the strong simply dominate the weak. Law is how a society tries to be fair on purpose.",
      "Democracy is a system where power ultimately rests with the people, usually through voting. The idea is that those affected by decisions should have a say in them. It's not perfect, but it tends to protect freedom better than systems where one person or group holds all the power unchecked.",
      "Human rights are the basic protections every person deserves simply for being human — life, freedom, dignity, fair treatment. Justice is the effort to give people what they are genuinely owed, to right wrongs, and to treat people equally under the law. Both are ideals we never fully reach, but striving toward them is what keeps a society humane.",
    ],
    priority: 6,
  },
  {
    triggers: ['what is economics', 'how does money work', 'what is the economy', 'why do prices go up', 'what is inflation', 'how does trade work', 'what is poverty'],
    responses: [
      "Economics is the study of how people use limited resources to meet unlimited wants. Money is simply a tool that makes trade easier — instead of swapping a goat for bread, you use a shared unit everyone accepts. The economy is the sum of all the buying, selling, working, and producing a society does.",
      "Prices go up for a few main reasons: more demand than supply, rising costs to produce things, or inflation — which is when money loses value over time, so each rand buys a little less than before. Understanding this helps you see that prices aren't random; they're signals about supply, demand, and the value of money itself.",
      "Trade works because people and countries are good at different things. Instead of each making everything badly, they specialise and exchange — everyone ends up better off. Poverty is the lack of resources to meet basic needs, and it's often less about laziness than about lacking access to opportunity, education, and stability. Economics, at its heart, is about how we share a limited world.",
    ],
    priority: 6,
  },
  {
    triggers: ['why do wars happen', 'what causes war', 'what is peace', 'how do countries resolve conflict', 'why is peace important', 'what is diplomacy'],
    responses: [
      "Wars usually happen over resources, power, land, ideology, or fear. Underneath the politics is almost always a failure to resolve conflict any other way. War is rarely the goal itself — it's what happens when negotiation, fairness, and trust break down. Understanding that helps you see how many wars might have been prevented.",
      "Peace is more than the absence of fighting — it's a state where conflict can be handled without violence, through fairness, dialogue, and shared rules. It matters because war destroys not just lives but the conditions for everything good: education, family, growth, hope. Peace is the soil that lets a society flourish.",
      "Diplomacy is the art of resolving differences through conversation instead of force. Countries use negotiation, compromise, and agreements to settle disputes before they explode. It takes patience and the willingness to understand the other side — which is exactly why it's hard, and exactly why it's so valuable when it works.",
    ],
    priority: 6,
  },
  {
    triggers: ['what is religion', 'why do people believe in god', 'what are different religions', 'what is faith', 'why does religion matter to people', 'what is spirituality'],
    responses: [
      "Religion is a system of beliefs, practices, and community centred on questions of meaning, morality, and what lies beyond the visible world. People believe for many reasons — comfort, purpose, tradition, genuine experience of the sacred. Whatever your own view, religion has shaped human history, art, and ethics more than almost anything else.",
      "There are many major religions — Christianity, Islam, Hinduism, Buddhism, Judaism, and others — each with its own teachings, but most share core themes: how to live well, treat others, and face life and death. Faith is trust in something beyond proof, a willingness to live by a belief you can't fully verify. For billions, it's the centre of how they make sense of life.",
      "Spirituality is the personal search for meaning, connection, and something larger than yourself — it can exist within a religion or outside one. It matters to people because humans naturally hunger for purpose and for the sense that life is more than just survival. Whether through prayer, nature, or reflection, it's one of the oldest human pursuits.",
    ],
    priority: 6,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // v6: Intermediate English
  // ══════════════════════════════════════════════════════════════════════════
  {
    triggers: ['what is an idiom', 'common english idioms', 'what does it mean when people say', 'english expressions', 'what does that phrase mean', 'idioms in english'],
    responses: [
      "An idiom is a phrase whose meaning isn't literal — you can't work it out from the individual words. Here are some common ones: 'break the ice' means to start a conversation; 'hit the nail on the head' means to be exactly right; 'under the weather' means feeling sick; 'cost an arm and a leg' means very expensive; 'bite the bullet' means to do something difficult; and 'the ball is in your court' means it's your decision now.",
      "Idioms are expressions native speakers use all the time, and they make your English sound natural. For example, 'break the ice' (start a conversation), 'under the weather' (feeling unwell), 'cost an arm and a leg' (very expensive), and 'bite the bullet' (face something hard). The trick is to learn them in context, not as a list — notice how and when people actually use them.",
      "When someone uses a phrase that doesn't make literal sense, it's probably an idiom. 'Hit the nail on the head' means being exactly correct. 'The ball is in your court' means the decision is yours. 'Bite the bullet' means doing something unpleasant you've been avoiding. Tell me a specific phrase you heard and I'll explain exactly what it means.",
    ],
    priority: 6,
  },
  {
    triggers: ['difference between formal and informal english', 'how to write formally', 'when to use formal english', 'professional english', 'how to write an email in english', 'formal language'],
    responses: [
      "Formal English is what you use for work, school, and people you don't know well — it avoids slang, uses full words instead of contractions, and stays polite and precise. Informal English is for friends and family — relaxed, with slang and shortcuts. The skill is knowing your audience: 'I would like to request a meeting' is formal; 'Can we meet?' is casual. Both are correct in the right setting.",
      "To write a good email in English, keep it clear and structured. Start with a greeting ('Dear Mr Smith' for formal, 'Hi Sarah' for casual). State your purpose early and simply. Keep paragraphs short. Close politely ('Kind regards' for formal, 'Thanks' for casual). The golden rule: when in doubt, lean slightly more formal — it's easier to relax later than to recover from sounding rude.",
      "The main differences are word choice and tone. Formal English avoids contractions (use 'do not' instead of 'don't'), avoids slang, and uses more complete sentences. Use it for job applications, official emails, and anyone in authority. Informal English is warmer and looser — perfect for friends, but it can seem careless in professional settings. Match the register to the relationship.",
    ],
    priority: 6,
  },
  {
    triggers: ['how do i write a paragraph', 'how to write well', 'what makes good writing', 'how to structure writing', 'how to start a paragraph', 'tips for writing in english'],
    responses: [
      "A strong paragraph has one main idea. Start with a topic sentence that states that idea clearly. Follow it with two or three sentences that explain, prove, or give an example. End with a sentence that wraps up or links to what comes next. If a sentence doesn't support the main idea, cut it — focus is what makes writing strong.",
      "Good writing is clear before it's clever. Use short sentences when the idea is important. Pick simple, exact words over fancy ones. Read your work aloud — if you stumble, your reader will too. And always know what one point you're trying to make in each paragraph; confusion in writing usually comes from trying to say too many things at once.",
      "To start a paragraph well, lead with your strongest, clearest statement of the idea — don't bury it. Then build: explain it, support it with a reason or example, and finish cleanly. Think of each paragraph as a tiny argument: claim, evidence, conclusion. Do that consistently and your writing will feel organised and confident.",
    ],
    priority: 6,
  },
  {
    triggers: ['common english mistakes', 'grammar mistakes', 'how to avoid mistakes in english', 'english errors', 'mistakes people make in english', 'how to improve english'],
    responses: [
      "A few of the most common English mistakes: confusing 'your' (belonging to you) and 'you're' (you are); 'their / there / they're'; and 'its' (belonging to it) versus 'it's' (it is). Another big one is subject-verb agreement, like saying 'he go' instead of 'he goes'. Learning these few patterns well will fix most everyday errors.",
      "People often mix up similar words: 'affect' (to influence) versus 'effect' (the result); 'then' (time) versus 'than' (comparison); and 'fewer' (for things you count) versus 'less' (for things you can't). The best way to avoid these is to read a lot — your ear learns what's right faster than rules alone can teach you.",
      "To improve your English and cut mistakes, do three things: read regularly so correct patterns sink in, write often so you practise producing them, and don't fear errors — they're how you learn. Focus especially on the small confusing pairs like 'your/you're' and 'its/it's', because fixing those instantly makes your writing look more polished.",
    ],
    priority: 6,
  },
  {
    triggers: ['how to sound confident in english', 'how to speak english well', 'how to improve my english', 'tips for speaking english', 'how to speak more fluently', 'how to get better at english'],
    responses: [
      "Confidence in English comes from practice, not perfection. Speak slowly and clearly rather than rushing — pausing is fine and even sounds thoughtful. Don't aim to be flawless; aim to be understood. Every fluent speaker started by making mistakes out loud. The people who improve are the ones who keep talking anyway.",
      "To speak more fluently, immerse yourself: watch shows, listen to podcasts, and repeat phrases aloud to train your mouth and ear together. Learn whole phrases, not just single words, so you have ready-made building blocks. And find any chance to actually speak — conversation, even messy conversation, teaches you faster than studying alone ever will.",
      "The fastest way to get better at English is to use it daily, even imperfectly. Think in English when you can, narrate your day in your head, and don't translate word for word from your first language. Confidence grows every time you successfully make yourself understood — so chase being understood, not being perfect.",
    ],
    priority: 6,
  },
  {
    triggers: ['english proverbs', 'what is a proverb', 'common proverbs', 'what do proverbs mean', 'proverbs and meanings', 'wise sayings in english'],
    responses: [
      "A proverb is a short, well-known saying that carries a piece of wisdom. Here are some common ones: 'Actions speak louder than words' means what you do matters more than what you say; 'Every cloud has a silver lining' means there's good in every bad situation; 'Better late than never' means doing something late beats not doing it; and 'Don't judge a book by its cover' means don't judge by appearances.",
      "Proverbs pack life lessons into a single line. 'The early bird catches the worm' means those who act first get the reward. 'When in Rome, do as the Romans do' means adapt to the customs of where you are. 'Don't judge a book by its cover' warns against judging on appearances. They're worth learning because native speakers use them to make a point quickly.",
      "Proverbs are the condensed wisdom of a culture. A few to know: 'Actions speak louder than words', 'Every cloud has a silver lining', 'Better late than never', 'The early bird catches the worm', and 'When in Rome, do as the Romans do'. Each one captures a truth people have repeated for generations — learning them gives you both better English and a little wisdom.",
    ],
    priority: 6,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // v6: Arts & Creativity
  // ══════════════════════════════════════════════════════════════════════════
  {
    triggers: ['what is art', 'why is art important', 'what makes something art', 'why do humans make art', 'what is the purpose of art', 'is art important'],
    responses: [
      "Art is human expression made visible — an attempt to capture feeling, beauty, or truth in a form others can experience. It's important because it says what plain facts can't. A painting, a song, a poem can carry an emotion straight into someone else's heart. Art is how we share the inside of being human.",
      "What makes something art isn't perfection — it's intention and meaning. Humans make art because we have an irresistible need to express, to be understood, and to make sense of our experience. Every culture in history made art, even before they had writing. It seems to be as fundamental to us as language.",
      "The purpose of art is partly to move us and partly to make us see. It can comfort, provoke, question, or simply make life more beautiful. Art matters because a world of pure function would be unbearable — it's the things we make for meaning, not just survival, that make life worth living.",
    ],
    priority: 6,
  },
  {
    triggers: ['why does music affect us', 'why do we love music', 'what does music do to the brain', 'why is music powerful', 'how does music make us feel', 'why do humans make music'],
    responses: [
      "Music affects us because it speaks directly to emotion, bypassing logic. Rhythm syncs with our bodies and heartbeats, and melody can trigger memory and feeling instantly. Scientists find that music lights up nearly every part of the brain at once, including the reward centres — which is why a great song can give you literal chills.",
      "We love music because it connects us — to our own feelings, to memories, and to other people. A song can hold a moment of your life so completely that hearing it years later brings the whole feeling rushing back. Humans have made music in every culture and era; it seems to be wired into us as a way to feel and to belong.",
      "Music is powerful because it lets us feel emotions safely and share them with others. It can lift you up, help you grieve, energise a crowd, or calm a racing mind. The brain releases feel-good chemicals when we hear music we love, which is part of why it can genuinely improve your mood and even your health.",
    ],
    priority: 6,
  },
  {
    triggers: ['how do you write a good story', 'what makes a good story', 'how to be a better writer', 'what is storytelling', 'how to create characters', 'how to write fiction'],
    responses: [
      "A good story is built on a character who wants something and faces obstacles getting it. That simple engine — desire plus conflict — creates tension, and tension is what keeps a reader turning pages. Make us care about the character first; then make their struggle real. Everything else is detail.",
      "Strong characters feel real because they have wants, flaws, and contradictions, just like people. Don't make them perfect — perfect is boring. Give them something to lose and a weakness that gets in their way. Readers connect with struggle, not flawlessness. Show us a character trying and failing, and we'll follow them anywhere.",
      "To become a better writer, write regularly and read even more. Storytelling is the art of arranging events so they build meaning and emotion. Start with conflict, show rather than tell where you can, and cut anything that doesn't move the story forward. The first draft is just you discovering the story; the real writing happens in rewriting.",
    ],
    priority: 6,
  },
  {
    triggers: ['what makes a good movie', 'how do films tell stories', 'what is cinema', 'how does a film work', 'what is directing', 'why do we love movies'],
    responses: [
      "A good movie combines a compelling story with the power of image and sound. Film tells stories visually — through what you see, not just what's said. A look, a setting, a piece of music can convey more than a page of dialogue. The best films make you feel something you can't quite put into words.",
      "Cinema is storytelling through moving pictures, sound, and time. Directing is the art of pulling all the pieces together — performances, camera, lighting, pace — into one unified vision. A director decides what you see, when, and how, guiding your emotions shot by shot. Great directing is invisible; you just feel its effect.",
      "We love movies because they let us live other lives for a couple of hours — to feel fear, love, and adventure from a safe seat. A film works by guiding your attention and emotion deliberately: the music tells you how to feel, the editing controls the rhythm, the framing decides what matters. It's a deeply crafted illusion, and we happily fall into it.",
    ],
    priority: 6,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // v6: Sports & Physical Life
  // ══════════════════════════════════════════════════════════════════════════
  {
    triggers: ['why is sport important', 'why do humans play sports', 'what is the value of sport', 'why do people love sports', 'what does sport teach you', 'benefits of playing sports'],
    responses: [
      "Sport matters because it builds the body and the character at the same time. It teaches discipline, resilience, and how to handle both winning and losing with grace. Beyond fitness, it gives people a shared passion and a sense of belonging — few things unite strangers like a team they both support.",
      "Humans love sport because it's a safe arena for our oldest instincts — competition, teamwork, the thrill of testing yourself. It teaches you to keep going when it's hard, to trust teammates, and to accept that you can give everything and still lose. Those lessons carry far beyond the field.",
      "The value of sport is in what it demands of you: practice when you don't feel like it, focus under pressure, and getting back up after defeat. It builds confidence through effort, not luck. Whether you play or watch, sport reminds us that growth comes from showing up and trying again and again.",
    ],
    priority: 6,
  },
  {
    triggers: ['how do i get fit', 'what is physical fitness', 'why should i exercise', 'how does exercise help the body', 'how to stay in shape', 'what does working out do'],
    responses: [
      "Getting fit starts with consistency, not intensity. Pick something you can actually keep doing — walking, running, bodyweight workouts — and do it regularly. Fitness is the body's ability to handle physical demands, and it improves a little every time you push it slightly. The best exercise is the one you'll stick with.",
      "Exercise helps the body in almost every way: it strengthens your heart and muscles, improves your mood by releasing feel-good chemicals, sharpens your mind, and protects against many diseases. You don't need a gym to start — even regular brisk walking makes a real difference. The hardest part is beginning; momentum does the rest.",
      "To stay in shape, combine movement that raises your heart rate with some strength work, and keep it consistent. Working out doesn't just change how you look — it changes how you feel, think, and sleep. Start small, stay regular, and let it build. Your future self is shaped by the habits you keep now.",
    ],
    priority: 6,
  },
  {
    triggers: ['what is teamwork', 'how to be a good team player', 'why is competition healthy', 'what is sportsmanship', 'how to work in a team', 'what does competition teach you'],
    responses: [
      "Teamwork is people combining their strengths toward a shared goal, where the group achieves what no individual could alone. To be a good team player, communicate clearly, do your part reliably, and put the team's success above your own ego. Trust is the currency of every good team — earn it by being dependable.",
      "Healthy competition pushes you to be better than you'd be on your own. It's healthy when it's about raising your own standard, not tearing others down. Sportsmanship is exactly that balance: competing hard while still respecting your opponent. Winning with grace and losing with dignity both build real character.",
      "Working well in a team means listening as much as contributing, supporting others, and handling disagreement without making it personal. Competition, done right, teaches you to perform under pressure, accept results honestly, and respect those who beat you. Both teamwork and competition prepare you for almost everything else in life.",
    ],
    priority: 6,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // v6: Food & Everyday Life
  // ══════════════════════════════════════════════════════════════════════════
  {
    triggers: ['what is healthy food', 'why do we need to eat', 'what is nutrition', 'what should i eat', 'what makes food healthy', 'how does food affect the body'],
    responses: [
      "We eat because food is fuel — it gives the body energy and the materials to build and repair itself. Nutrition is the study of how food affects us. Healthy food is mostly whole and unprocessed: vegetables, fruit, whole grains, lean proteins, and water. The simplest rule is to eat food close to how it appears in nature.",
      "Healthy food gives your body what it needs without overloading it with sugar, salt, and processed fat. Balance is key — a mix of proteins to build, carbohydrates for energy, healthy fats, and plenty of vegetables. You don't need a perfect diet; you need a mostly good one, most of the time. Consistency beats perfection.",
      "Food affects everything — your energy, mood, focus, and long-term health. Eat poorly and you feel sluggish and foggy; eat well and your body and mind both run better. You don't have to overhaul everything at once. Start by adding more whole foods and water, and let the better habits crowd out the worse ones gradually.",
    ],
    priority: 6,
  },
  {
    triggers: ['how do i learn to cook', 'what is cooking', 'basic cooking skills', 'how to start cooking', 'what should a beginner cook', 'why is cooking important'],
    responses: [
      "Cooking is one of the most useful life skills you can learn, and you start by keeping it simple. Master a few basics — boiling, frying, roasting — and a handful of easy meals you can repeat. Eggs, rice dishes, simple pasta, and a basic stew are great beginner wins. Confidence in the kitchen is built one recipe at a time.",
      "Cooking matters because it gives you control over what you eat, saves money, and is genuinely satisfying. To start, pick one simple recipe and make it until it feels easy, then add another. Don't fear mistakes — even a slightly burnt first attempt teaches you something. Everyone who can cook well was once a beginner who kept trying.",
      "Basic cooking skills include chopping safely, knowing how heat changes food, and seasoning to taste. Start with meals that are hard to ruin, like a vegetable stir-fry or a one-pot rice dish. Taste as you go — that single habit is what turns following recipes into actually knowing how to cook. Keep it simple and build from there.",
    ],
    priority: 6,
  },
  {
    triggers: ['how do i manage money', 'what is a budget', 'how to save money', 'basic money management', 'how to spend less', 'what is financial planning'],
    responses: [
      "Managing money starts with knowing where it goes. A budget is simply a plan for your money: list what comes in, list what goes out, and make sure the second is smaller than the first. The basic rule that helps most people is to save a little before you spend, not whatever happens to be left over.",
      "To save money, track your spending for a month — most people are surprised where it actually goes. Then cut the things you won't miss, and automate saving a fixed amount the moment you get paid. Small, consistent saving beats occasional big efforts. Wealth is built quietly over time, not in one dramatic move.",
      "Financial planning is deciding today how you want money to serve your future. The fundamentals are simple: spend less than you earn, save consistently, avoid unnecessary debt, and build a small emergency fund first. None of it is complicated — the challenge is discipline. Start small; the habit matters more than the amount.",
    ],
    priority: 6,
  },
  {
    triggers: ['how do i manage my time', 'how to be more productive', 'what is time management', 'how to stop wasting time', 'how to get more done', 'tips for managing time'],
    responses: [
      "Time management is really about deciding what matters and protecting time for it. Start each day by choosing your two or three most important tasks and doing those first, before the distractions arrive. You can't do everything — productivity is mostly about choosing what to leave undone.",
      "To stop wasting time, notice where it leaks — usually it's the phone and unplanned scrolling. Try working in focused blocks with short breaks, and remove the distraction before it tempts you rather than relying on willpower. Doing fewer things with full attention beats doing many things half-present.",
      "Getting more done isn't about being busy; it's about being deliberate. Plan your day the night before, tackle the hardest task while your energy is fresh, and group similar small tasks together. And protect your rest too — a tired mind is slow and sloppy. Real productivity is a rhythm of focus and recovery, not constant grinding.",
    ],
    priority: 6,
  },

  // ── v7: Advanced English language ─────────────────────────────────────────
  {
    triggers: ['what are phrasal verbs', 'examples of phrasal verbs', 'common phrasal verbs', 'how to use phrasal verbs', 'what is a phrasal verb', 'english phrasal verbs'],
    responses: [
      "A phrasal verb is a verb combined with a preposition or adverb that together create a brand-new meaning. \"Give up\" means to stop trying. \"Look forward to\" means to be excited about something coming. \"Get along with\" means to have a good relationship with someone. The tricky part is that the meaning often has nothing to do with the individual words, so you learn them as whole units.",
      "Phrasal verbs are everywhere in natural English. A few useful ones: \"run out of\" (to have none left), \"bring up\" (to mention a topic, or to raise a child), \"figure out\" (to understand or solve something), \"put off\" (to delay), and \"come across\" (to find something unexpectedly, or to seem a certain way). The best way to learn them is in context, not from a list.",
      "Think of a phrasal verb as a verb plus a small word that changes everything. \"Look\" means to see; \"look after\" means to take care of; \"look up\" means to search for information; \"look forward to\" means to anticipate something happily. Same verb, completely different meanings. Notice them when you read and watch, and they'll stick faster than memorizing.",
    ],
    priority: 7,
  },
  {
    triggers: ['what are conditionals in english', 'how to use if in english', 'conditional sentences', 'how do i say if i were', 'first second third conditional', 'how to talk about hypotheticals'],
    responses: [
      "Conditionals are \"if\" sentences, and there are four main types. Zero conditional is for facts that are always true: \"If you heat water to 100°C, it boils.\" First conditional is for likely future situations: \"If it rains, I will stay home.\" Second is for unlikely or imaginary present: \"If I had a million dollars, I would travel.\" Third is for the impossible past, usually regret: \"If I had studied harder, I would have passed.\"",
      "The four conditionals map to how real the situation is. Always true (zero): \"If you drop it, it falls.\" Likely (first): \"If I finish early, I'll call you.\" Imaginary (second): \"If I were rich, I'd help everyone.\" Impossible past (third): \"If I had known, I would have come.\" A key tip: in the second conditional, use \"were\" for all subjects — \"If I were you,\" not \"If I was you.\"",
      "Conditionals confuse a lot of learners, but the logic is simple once you see it. The further from reality the situation is, the further back the verb tense goes. Real and likely uses present plus \"will.\" Imaginary present uses past plus \"would.\" Impossible past uses past perfect plus \"would have.\" Remember \"If I were you\" — that \"were\" is the polite, correct form even though it sounds unusual.",
    ],
    priority: 7,
  },
  {
    triggers: ['how to connect sentences in english', 'transition words in english', 'connective words', 'how to link ideas in english', 'words that connect sentences', 'how to make writing flow'],
    responses: [
      "Connective words are the glue that makes writing flow. For adding ideas: \"also, moreover, furthermore, in addition.\" For contrast: \"however, although, despite, on the other hand, whereas.\" For cause and effect: \"therefore, as a result, consequently, because of this.\" Pick the one that matches the relationship between your ideas, and your writing instantly feels more connected.",
      "To link ideas smoothly, learn a few transitions by category. Sequence: \"first, then, next, finally, afterwards.\" Emphasis: \"in fact, indeed, above all, most importantly.\" Contrast: \"however, although, whereas.\" The mistake to avoid is overusing them — one good transition per idea-shift is enough. Too many and the writing feels stuffed.",
      "Good flow comes from showing the reader how each idea relates to the last. Are you adding (\"moreover\")? Contrasting (\"however\")? Showing a result (\"therefore\")? Listing steps (\"first, then, finally\")? Once you name the relationship in your own head, the right connective becomes obvious. Read your writing aloud — if it jumps, a transition is missing.",
    ],
    priority: 7,
  },
  {
    triggers: ['how to write a professional email', 'email writing in english', 'how to write a formal email', 'professional email structure', 'how to start an email', 'how to end an email professionally'],
    responses: [
      "A professional email has clear parts. Subject line: specific, like \"Meeting request — Thursday 2pm.\" Opening: \"Dear [Name],\" for formal, \"Hi [Name],\" for semi-formal. First sentence: state your purpose immediately — \"I am writing to...\" Body: one idea per paragraph, short sentences, no jargon. Close: \"Kind regards,\" or \"Best regards,\" or \"Thank you,\". Then reread before sending.",
      "Start an email by getting to the point fast. Busy people skim, so your first line should say why you're writing. Keep each paragraph to one idea, use simple words, and avoid long blocks of text. To close, \"Kind regards\" and \"Best regards\" are safe and professional. The golden rule: read it out loud before sending — if it sounds rude spoken, rewrite it warmer.",
      "Professional emails are about clarity and respect for the reader's time. A clear subject line, a polite greeting, your purpose stated upfront, a tidy body, and a courteous sign-off. \"Dear\" is formal; \"Hi\" is friendlier but still fine for work. End with \"Kind regards\" or \"Thank you.\" And always proofread — a small typo can undercut an otherwise sharp message.",
    ],
    priority: 7,
  },
  {
    triggers: ['how to give a presentation in english', 'how to speak in public in english', 'tips for presenting in english', 'how to structure a speech', 'how to start a presentation', 'public speaking tips in english'],
    responses: [
      "A strong presentation has three parts: an opening that grabs attention, a middle with no more than three main points, and a close with a clear summary or call to action. The structure does half the work. Limit yourself to three points because people simply can't hold more than that. Tell them what you'll say, say it, then remind them what you said.",
      "When presenting, speak slower than feels natural — nerves make us rush, and slowing down sounds confident. Pause for effect; silence is powerful. Make eye contact with individuals, not the wall. And know your very first sentence by heart, so nerves don't sabotage your opening. Once you start strong, momentum carries you.",
      "Public speaking gets easier with structure and preparation. Open with a hook — a question, a surprising fact, a short story. Cover your three key points clearly. Close by telling people what to do or think next. Practical tips: breathe, slow down, pause, and look at faces. The audience wants you to succeed, so let yourself believe that.",
    ],
    priority: 7,
  },
  {
    triggers: ['how to express an opinion in english', 'how to disagree without being rude', 'polite way to share your view', 'how to say i disagree professionally', 'how to debate in english', 'how to argue your point politely'],
    responses: [
      "To express an opinion politely, soften it with a phrase: \"In my view...\", \"From my perspective...\", \"I believe that...\", or \"It seems to me that...\". These signal it's your view, not an absolute fact, which makes people more open to hearing it. The same idea can land as arrogant or thoughtful depending entirely on the phrase you choose.",
      "Disagreeing without being rude is a skill. Acknowledge first, then push back: \"I see your point, however...\", \"That's a fair point, but I think...\", \"I respectfully disagree because...\", or \"With respect, I see it differently.\" The rule is simple — make the person feel heard before you challenge their idea, and they'll actually listen.",
      "In a debate or discussion, the most persuasive people don't steamroll — they acknowledge then redirect. Start with \"You make a good point\" or \"I understand why you'd think that,\" then offer your view with a reason: \"...but I'd argue that, because...\". Attacking the idea is fine; attacking the person never is. Stay on the argument, keep your tone calm.",
    ],
    priority: 7,
  },
  {
    triggers: ['how to understand what i read', 'how to improve reading comprehension', 'i read but dont understand', 'how to read better', 'tips for reading in english', 'how to understand english texts'],
    responses: [
      "Reading comprehension improves with technique, not just effort. Read the title and headings first to predict what's coming. Read once for the general meaning without stopping at every word. Then read again for detail. Only look up words that actually block your understanding, not every unknown word. And summarize each paragraph in one sentence after you finish it.",
      "If you read but don't understand, you're probably stopping too often. Let your eyes flow through a passage once to catch the gist, even if you miss some words — context fills in a lot. Then go back for detail. Looking up every single unfamiliar word breaks your momentum and your comprehension. Trust yourself to ride past the gaps the first time.",
      "To read better, practice daily with material just one level above your comfort zone — challenging but not impossible. Predict from the title, read for meaning first, reread for detail, and try summing up each paragraph in your own words. That last step is the secret: if you can summarize it, you understood it. If you can't, read it again.",
    ],
    priority: 7,
  },
  {
    triggers: ['difference between british and american english', 'british vs american english', 'uk vs us english', 'which english should i learn', 'american spelling vs british spelling', 'british or american english'],
    responses: [
      "British and American English differ in spelling, vocabulary, and pronunciation, but both are completely correct. Spelling: colour/color, favour/favor, realise/realize. Vocabulary: lift/elevator, biscuit/cookie, flat/apartment, boot/trunk, queue/line. My advice: pick one variety and be consistent. Both are understood everywhere, so clarity matters far more than which one you choose.",
      "The main differences are spelling (British keeps the \"u\" in colour, neighbour; American drops it), some everyday words (British \"flat\" vs American \"apartment,\" British \"queue\" vs American \"line\"), and accent. Neither is better. If you're learning, choose the one that fits your goals or surroundings, stay consistent, and don't stress — both are global and respected.",
      "There's no \"right\" English between British and American — they're two valid standards. You'll notice spelling shifts (organise/organize), word swaps (lorry/truck, holiday/vacation), and pronunciation. The most important thing is being understood, so be consistent within one variety rather than mixing them. People around the world communicate fine in both every day.",
    ],
    priority: 7,
  },
  {
    triggers: ['what are question tags', 'how to use question tags', 'isnt it right', 'question tags in english', 'how do you add a question at the end', 'tag questions in english'],
    responses: [
      "A question tag is a short question added to the end of a statement, like \"isn't it?\" The rule is opposites: a positive statement takes a negative tag, and a negative statement takes a positive tag. \"It's cold today, isn't it?\" \"You've been here before, haven't you?\" \"She doesn't know, does she?\" The verb in the tag matches the verb in the statement.",
      "Question tags turn statements into questions to check or invite agreement. Positive sentence, negative tag: \"They finished, didn't they?\" Negative sentence, positive tag: \"He can't swim, can he?\" The key is matching the auxiliary verb — \"is\" pairs with \"isn't,\" \"have\" with \"haven't,\" \"did\" with \"didn't.\" Get the verb right and the tag falls into place.",
      "Tags like \"isn't it?\" or \"don't you?\" are how English speakers nudge for agreement. The trick is the flip: if the statement is positive, the tag goes negative, and vice versa. \"You're coming, aren't you?\" \"She isn't ready, is she?\" Match the verb and the subject, flip the polarity, and you've got it.",
    ],
    priority: 7,
  },
  {
    triggers: ['how do i learn english faster', 'tips to improve english quickly', 'best way to learn english', 'how to get better at english fast', 'how long does it take to learn english', 'what is the fastest way to learn english'],
    responses: [
      "The fastest way to learn English is immersion, not just study. Surround yourself with it — shows, music, podcasts, reading. Speak from day one, even badly, because mistakes teach you faster than perfect silence. Focus first on the 1000 most common words; they cover about 80% of everyday speech. And above all, be consistent — a little every day beats a lot once a week.",
      "To improve quickly, make English part of your daily life rather than a subject you sit down to. Find a reason to use it every day: a journal, a friend, an online community. Make mistakes on purpose — they're the fastest teachers. Learn the most frequent words first. Consistency beats intensity every single time; ten minutes daily outperforms three hours once a week.",
      "There's no magic shortcut, but there is a fastest path: immerse, speak early, and stay consistent. Watch and read things you enjoy in English, talk even when you're not ready, and don't fear errors — they're proof you're trying. Concentrate on common vocabulary you'll actually use. The people who improve fastest are simply the ones who use English every day.",
    ],
    priority: 7,
  },
  {
    triggers: ['how to use punctuation in english', 'when to use a comma', 'how to use an apostrophe', 'punctuation rules in english', 'common punctuation mistakes', 'how does punctuation work'],
    responses: [
      "Punctuation guides the reader. A comma separates items in a list, joins two sentences with a conjunction, and follows an introductory phrase. An apostrophe shows possession (\"the girl's book\") or marks a missing letter (\"don't\" = \"do not\"). A full stop ends a sentence; a question mark ends a direct question. The most common mistake is using an apostrophe to make a plural — \"apple's\" when you mean \"apples\" is wrong.",
      "The big rules: commas create pauses and separate ideas — lists, joined sentences, after intro phrases. Apostrophes do two jobs: possession (\"Dian's idea\") and contractions (\"can't\" = \"cannot\"). They never make a word plural. Full stops close statements, question marks close questions. Master those few and your writing instantly reads cleaner.",
      "Punctuation is mostly about clarity. Use a comma to separate list items or to pause between linked ideas. Use an apostrophe for ownership or to show letters are missing — never to make something plural. End sentences with a full stop, questions with a question mark. The single most common error is the apostrophe in plurals: \"banana's\" for sale should just be \"bananas.\"",
    ],
    priority: 7,
  },
  {
    triggers: ['how to have a difficult conversation in english', 'how to say something hard in english', 'how to bring up a sensitive topic', 'how to talk about problems in english', 'how to confront someone politely in english', 'how to address a conflict in english'],
    responses: [
      "Start a difficult conversation with your feeling, not an accusation. Say \"I feel worried when...\" instead of \"You always...\". Use \"I\" statements, name the specific behavior rather than attacking their character, and ask questions to understand before you defend yourself. End with what you actually need or want to change. The hardest part is starting, so prepare your first sentence word for word.",
      "When something is hard to say, structure protects the relationship. Lead with how you feel, point to one specific thing they did rather than a sweeping \"you never,\" and stay curious — ask before you assume. \"I felt hurt when the plan changed without a heads-up\" lands far better than \"You don't respect me.\" Same concern, completely different outcome.",
      "Confronting someone politely is about being honest without being cruel. Use \"I\" statements so it doesn't feel like an attack. Describe the specific behavior, not their whole character. Listen as much as you talk. And remember the goal isn't to win — it's to be understood and to understand. Plan your opening line in advance; once you start, the rest gets easier.",
    ],
    priority: 7,
  },

  // ── v7: Deep human nature & psychology ──────────────────────────────────────
  {
    triggers: ['what is attachment style', 'secure anxious avoidant attachment', 'why do i cling to people', 'why do i push people away', 'how does childhood affect relationships', 'what is attachment theory'],
    responses: [
      "Attachment theory, from John Bowlby, says we develop a relationship \"template\" from our earliest bonds with caregivers. Secure attachment means you're comfortable with both closeness and independence. Anxious attachment fears abandonment and craves reassurance. Avoidant attachment is uncomfortable with closeness and values independence to a fault. These patterns run unconsciously in adult relationships.",
      "If you cling to people or push them away, attachment style may explain it. Anxious types fear being left and seek constant reassurance; avoidant types feel smothered by closeness and pull back. There's also a disorganized style that mixes both fear and need. None of this is your fault — it formed early. But understanding your pattern is the first real step to changing it.",
      "Childhood shapes how we love. The bond with our earliest caregivers becomes a blueprint: secure if our needs were reliably met, anxious if love felt unpredictable, avoidant if closeness felt unsafe. As adults we replay these patterns without noticing. The hopeful part is that attachment styles can shift — through awareness, safe relationships, and sometimes therapy.",
    ],
    priority: 7,
  },
  {
    triggers: ['what is emotional intelligence', 'how to develop emotional intelligence', 'what is eq', 'why is emotional intelligence important', 'how to understand emotions better', 'what does emotionally intelligent mean'],
    responses: [
      "Emotional intelligence, or EQ, has four pillars: self-awareness (knowing what you feel and why), self-regulation (managing those feelings), empathy (understanding what others feel), and social skill (handling relationships well). Research consistently shows EQ predicts success in life better than IQ. And unlike IQ, you can develop it — it starts with the simple habit of pausing before you react.",
      "Being emotionally intelligent means you notice your own emotions, manage them instead of being run by them, sense what others are feeling, and navigate people skillfully. It matters because relationships and self-control shape almost everything — work, love, leadership. The good news is EQ is a skill, not a fixed trait. Awareness is where it begins.",
      "EQ is the ability to understand and work with emotions — yours and other people's. The four parts are self-awareness, self-regulation, empathy, and social skill. It's important because raw intelligence doesn't help much if you can't manage your reactions or read a room. Build it by pausing, naming what you feel, and getting curious about what others feel too.",
    ],
    priority: 7,
  },
  {
    triggers: ['what is a cognitive bias', 'why do people make irrational decisions', 'common cognitive biases', 'why do humans think irrationally', 'what is confirmation bias', 'why do we have biases'],
    responses: [
      "Cognitive biases are mental shortcuts your brain uses to save energy — they work most of the time but fail in predictable ways. Confirmation bias makes you notice evidence that supports what you already believe and ignore what contradicts it. The sunk cost fallacy keeps you in something bad because you've already invested in it. Knowing they exist doesn't make you immune, but it makes you more careful.",
      "Humans think irrationally because the brain evolved for speed, not perfect accuracy. The availability heuristic makes us overestimate things we can easily recall — we fear plane crashes more than car accidents, though cars are far deadlier. Confirmation bias keeps us locked in our existing views. These aren't flaws of intelligence; they're built into how every human mind works.",
      "A cognitive bias is a systematic error in thinking. Confirmation bias: you seek out what proves you right. Sunk cost: you keep going because of what you've already spent. Anchoring: the first number you hear skews your judgment. Everyone has them, including the smartest people. The defense isn't to eliminate them — that's impossible — but to slow down on important decisions and question your gut.",
    ],
    priority: 7,
  },
  {
    triggers: ['what is intrinsic motivation', 'intrinsic vs extrinsic motivation', 'why do people lose motivation', 'what is the best type of motivation', 'how to stay motivated', 'why does reward sometimes kill motivation'],
    responses: [
      "Intrinsic motivation comes from inside — you do something because it's interesting, meaningful, or genuinely enjoyable. Extrinsic motivation comes from outside — money, grades, praise, avoiding punishment. Research by Deci and Ryan found that leaning too hard on external rewards can actually kill the inner drive, an effect called overjustification. The most sustainable motivation comes from within.",
      "The best motivation is usually intrinsic. When you do something for its own sake, you last; when you do it only for the reward, the drive fades the moment the reward stops. Surprisingly, paying people for something they already loved can make them enjoy it less. So the better question isn't \"what will I get?\" but \"what genuinely matters to me?\"",
      "People lose motivation when the why disappears. Extrinsic rewards — money, praise, approval — work in short bursts but don't sustain effort, and can even crowd out the natural enjoyment that drove you in the first place. To stay motivated long-term, connect the task to something you actually care about. Purpose outlasts pressure every time.",
    ],
    priority: 7,
  },
  {
    triggers: ['why do i sabotage myself', 'what is self-sabotage', 'why do i mess up good things', 'why do i ruin things for myself', 'how to stop self-sabotaging', 'why do i get in my own way'],
    responses: [
      "Self-sabotage is your brain trying to protect you from a threat — usually fear of failure, fear of success, or a deep sense of not being worthy. When something good is happening, an old inner voice whispers \"you don't deserve this\" or \"it'll fall apart anyway,\" so unconsciously you make it fall apart first. It feels like protection. The fix is awareness: notice the pattern and ask what you're really afraid of.",
      "If you ruin good things for yourself, it's rarely random — it's protection in disguise. Part of you expects loss or disappointment, so it pulls the plug early to avoid being blindsided. The way out is to catch it in the act: name it (\"I'm sabotaging this\"), then sit with the fear underneath instead of acting on it. The fear is always the real issue, not the thing you're wrecking.",
      "Self-sabotage happens when an old survival instinct collides with a new opportunity. Success or closeness can feel unsafe if some part of you doesn't believe you deserve it, so you create the very failure you feared. It's not weakness; it's a misfiring protection. To stop it, slow down when things are going well, notice the urge to retreat, and ask: what am I scared of losing here?",
    ],
    priority: 7,
  },
  {
    triggers: ['what is the inner critic', 'why do i talk badly to myself', 'how to stop negative self-talk', 'that voice in my head that says i am not good enough', 'how to silence the inner critic', 'negative self-talk'],
    responses: [
      "The inner critic is the voice inside that judges, attacks, and doubts you. It usually developed as a survival mechanism — in childhood, criticizing yourself first could prevent punishment or rejection by beating others to it. But it doesn't stop being cruel just because you've grown up. The goal isn't to silence it completely; it's to stop mistaking it for the truth.",
      "That voice saying \"you're not good enough\" isn't fact — it's fear wearing a costume. It often formed early as a way to stay safe, and now it runs on autopilot. You probably won't delete it entirely, but you can change your relationship with it. When it speaks, recognize it as an old protective voice, not an accurate judge. Then talk back, the way you'd defend a friend.",
      "Negative self-talk feels like the truth because it's familiar, but familiar isn't the same as true. The inner critic learned its job long ago and never updated. You can't always quiet it, but you can stop obeying it. Name it (\"that's my critic talking\"), question it (\"is this actually true?\"), and answer it with the kindness you'd give someone you love.",
    ],
    priority: 7,
  },
  {
    triggers: ['how does trauma affect behaviour', 'what is trauma', 'why do traumatic experiences stay with us', 'how does trauma show up', 'what does trauma do to a person', 'how to heal from trauma'],
    responses: [
      "Trauma is what happens inside a person after an overwhelming experience — it's less about the event itself and more about the nervous system's response to it. It can show up as hypervigilance (always waiting for something bad), emotional numbness, difficulty trusting, explosive reactions to small triggers, or physical symptoms. Healing is possible, but it needs safety, time, and often professional support.",
      "Traumatic experiences stay with us because the brain stores them differently — they remain activated, so the past can feel like the present. A small trigger can launch a full-body reaction that doesn't match the current moment. This isn't weakness or overreaction; it's a wound that hasn't healed. With safety and support, the nervous system can learn that the danger has passed.",
      "Trauma reshapes how a person feels and reacts. It might look like being constantly on guard, shutting down emotionally, struggling to trust, or reacting intensely to small things. The body remembers what the mind tries to forget. Healing isn't about erasing what happened — it's about helping the nervous system finally feel safe. That usually takes time and, for deep trauma, professional help.",
    ],
    priority: 7,
  },
  {
    triggers: ['why is it so hard to change', 'why cant i change', 'how do i actually change', 'why do people resist change', 'why do bad habits keep coming back', 'how does lasting change happen'],
    responses: [
      "Change is hard because your brain is wired to save energy and crave predictability. Old patterns are neural highways — fast, automatic, well-worn. New behavior is a dirt track — slow and effortful. Real change means being uncomfortable repeatedly until the new path becomes familiar. Willpower alone rarely lasts; changing your environment and your identity works far better.",
      "Bad habits come back because the old wiring is still there, waiting, and because the habit was meeting some real need — comfort, escape, connection. If you remove the habit without addressing the need, the need finds another outlet. Lasting change happens when you make the new behavior easier than the old one and when you start to see yourself as the kind of person who does it.",
      "People resist change because the brain treats the unknown as a threat. Even a bad-but-familiar situation can feel safer than an unfamiliar better one. To actually change, expect discomfort and keep going through it — that's the path becoming a habit. Two things help most: designing your environment so the good choice is the easy choice, and shifting your identity to \"I am someone who...\".",
    ],
    priority: 7,
  },
  {
    triggers: ['what is vulnerability', 'why is it important to be vulnerable', 'how do i open up to people', 'why is vulnerability hard', 'why do people guard themselves', 'what does it mean to be vulnerable'],
    responses: [
      "Brené Brown's research found that vulnerability — the willingness to show up without guarantees — is the birthplace of connection, creativity, belonging, and love. The wall you build to protect yourself is the same wall that keeps real connection out. Being vulnerable doesn't mean oversharing with everyone; it means being honest and present with the right people.",
      "Vulnerability is hard because it means risking rejection with no promise of acceptance. So people guard themselves — they keep things light, hide what they really feel, stay behind the wall. But that wall blocks the very closeness they want. Opening up doesn't mean dumping everything on everyone; it means letting the right people actually see you. The courage to be seen is deeply human.",
      "To be vulnerable is to let yourself be seen without armor — to say the honest thing, admit the fear, show the real feeling. It's frightening because it could lead to rejection. Yet it's also the only doorway to genuine connection; no one can love a version of you they never meet. Start small, with people who've earned your trust, and let it grow from there.",
    ],
    priority: 7,
  },
  {
    triggers: ['stages of grief', 'what are the stages of grief', 'how does grief work', 'why do people grieve differently', 'how long does grief last', 'is what i am feeling normal grief'],
    responses: [
      "Elisabeth Kübler-Ross identified five stages of grief: denial (this can't be real), anger (why did this happen), bargaining (if only I had...), depression (the weight of what's lost), and acceptance (finding a way to live with it). They're not linear — you can move back and forth, skip some, or stay in one a long time. Whatever you're feeling is likely a normal part of it.",
      "Grief works differently for everyone, and that's normal. The five well-known stages — denial, anger, bargaining, depression, acceptance — aren't a tidy sequence you complete and finish. People loop through them in their own order and on their own timeline. There's no \"right\" way and no deadline. Grief is love with nowhere to go, and it takes as long as it takes.",
      "What you're feeling is almost certainly normal. Grief applies to any loss — a person, a relationship, a dream, even a version of yourself — and it moves in waves, not a straight line. Some days are denial, some are anger, some are acceptance, and then it circles back. Don't let anyone rush you. There's no timeline on grief, and there doesn't need to be.",
    ],
    priority: 7,
  },
  {
    triggers: ['what is addiction', 'why do people get addicted', 'how does addiction work', 'why is addiction so hard to beat', 'what causes addiction', 'is addiction a choice'],
    responses: [
      "Addiction involves the brain's reward circuit being hijacked. Dopamine — the \"wanting\" chemical — fires when you encounter something that promises reward. With addictive substances or behaviors, that signal becomes so powerful it overrides rational thinking. Over time the brain adjusts, so you need more to feel the same effect and the absence feels unbearable. It's a brain disorder, not a moral failure.",
      "Addiction is hard to beat because it rewires the brain's reward system. What started as a choice becomes a compulsion as the brain adapts — needing more, tolerating the substance, and dreading its absence. It's usually rooted in pain, trauma, or an unmet need, which is why willpower alone rarely fixes it. The deeper question isn't \"why the addiction?\" but \"why the pain?\"",
      "Addiction isn't simply a choice or a weakness; it's a brain disorder. The reward circuit gets hijacked so the craving feels like survival, not preference. Many addictions grow from trying to numb something painful, so treating only the behavior misses the root. Real recovery usually addresses the underlying wound — and it almost always needs support, not just shame.",
    ],
    priority: 7,
  },
  {
    triggers: ['why do people conform', 'what is peer pressure', 'why do humans follow the crowd', 'what is social conformity', 'how does peer pressure work', 'why do people do things because others do them'],
    responses: [
      "Solomon Asch's famous experiments showed people would give obviously wrong answers just to match the group. Why? Because social rejection activates the same brain regions as physical pain. Belonging was a survival need for our ancestors — going against the group felt dangerous at a neurological level. The courage to be different isn't natural; it has to be developed.",
      "Peer pressure works because we're wired to belong. For most of human history, being cast out of the group meant death, so the brain treats social rejection as a real threat. That's why people follow the crowd even when the crowd is wrong — fitting in feels safer than being right alone. A strong internal compass and self-awareness are the best defenses against it.",
      "Humans conform because belonging once meant survival, and our brains haven't forgotten. Going against the group triggers genuine discomfort — the same circuitry as physical pain. That's why peer pressure is so powerful and so hard to resist in the moment. Standing apart takes deliberate courage, especially when the group asks you to betray what you actually believe.",
    ],
    priority: 7,
  },
  {
    triggers: ['what is empathy', 'how to be more empathetic', 'difference between empathy and sympathy', 'how to understand other people better', 'how do i develop empathy', 'why is empathy important'],
    responses: [
      "Empathy is the ability to feel with someone — to enter their experience rather than observe it from outside. Sympathy says \"I feel sorry for you\"; empathy says \"I feel with you, I'm in it too.\" You build it by asking more questions and talking less, suspending judgment, and genuinely trying to understand someone's reality before offering your own.",
      "The difference between empathy and sympathy matters. Sympathy looks at someone's pain from a distance; empathy steps in beside them. Empathy is a skill, not a fixed trait, and you develop it by getting curious about people who are different from you, listening to understand rather than to reply, and resisting the urge to fix or judge.",
      "Empathy means understanding another person's experience from the inside. It's important because it's the foundation of every real relationship — people open up to those who truly get them. To grow it: ask, listen, and hold back your judgment. Try to picture how the world looks from where they stand. The more curious you are about others, the more empathetic you become.",
    ],
    priority: 7,
  },
  {
    triggers: ['how to build self confidence', 'how to be more confident', 'what is self confidence', 'why do i lack confidence', 'how do i believe in myself', 'how to stop feeling insecure'],
    responses: [
      "Real confidence isn't the absence of doubt — it's acting in spite of it. It's built through evidence: small actions, promises kept to yourself, challenges attempted and survived. The people who look most confident often still carry doubt; they've just practiced not letting it make their decisions. The path is simple but not easy — do the thing you fear, see that you survive, repeat.",
      "You lack confidence because you're waiting to feel ready before you act — but confidence works the other way around. You act first, even scared, and the proof you can handle things builds the belief. There's no shortcut where you suddenly feel certain. Every confident person got there by stacking small wins, one uncomfortable step at a time.",
      "Self-confidence is trust in your ability to handle what comes, and it's earned, not granted. Each time you keep a promise to yourself or face something hard and come through, the evidence grows. Stop waiting to feel confident before you start; start, and the feeling follows. Confidence is the result of courage, not a prerequisite for it.",
    ],
    priority: 7,
  },
  {
    triggers: ['what is the meaning of life', 'why do humans need meaning', 'how to find meaning', 'what is logotherapy', 'what did viktor frankl say', 'how to live a meaningful life', 'why does life feel meaningless'],
    responses: [
      "Viktor Frankl survived the Nazi concentration camps and came out with one core conviction: meaning is the primary human drive. In \"Man's Search for Meaning\" he argued that people can endure almost any how if they have a why. Meaning can be found in work, in love, and even in suffering — by choosing your response to unavoidable pain. You don't find meaning like a lost key; you create it.",
      "Logotherapy, Frankl's approach, is built on the idea that the deepest human need is for meaning, not pleasure or power. He found meaning in three places: in what you create or accomplish, in whom you love and connect with, and in the stance you take toward unavoidable suffering. If life feels meaningless, the question to ask is what you can give your life to, not just get from it.",
      "Humans need meaning because, unlike other creatures, we ask why. When the why is missing, even comfort feels empty. Frankl taught that meaning isn't handed to you — it's created through what you devote yourself to: work, love, and the courage you bring to hardship. A meaningful life isn't the one with the least pain; it's the one where the pain and the joy both point to something that matters.",
    ],
    priority: 7,
  },
  {
    triggers: ['how do i forgive someone', 'what is forgiveness', 'why should i forgive', 'does forgiving mean accepting what happened', 'how to forgive and let go', 'why is forgiveness important'],
    responses: [
      "Forgiveness is not saying what happened was okay — it's releasing the grip that resentment has on you. Research consistently shows that holding onto anger damages the person holding it far more than the person who caused the harm. Forgiveness is something you do for yourself. It doesn't require the other person to apologize, change, or even still be in your life.",
      "Forgiving doesn't mean accepting the wrong or pretending it didn't hurt. It means deciding to stop letting the past keep wounding you in the present. The resentment you carry is a weight on you, not on them. You can forgive and still keep boundaries, still walk away. Letting go is the gift you give yourself, regardless of whether they ever earn it.",
      "Forgiveness matters because bitterness is a slow poison — it keeps the person who hurt you living rent-free in your mind. To forgive is not to excuse; it's to release your own grip on the anger so it stops running your life. It can be a process, not a single moment, and it asks nothing of the other person. It's about your freedom, not their pardon.",
    ],
    priority: 7,
  },
  {
    triggers: ['why do i procrastinate', 'how to stop procrastinating', 'what causes procrastination', 'why do i keep putting things off', 'procrastination psychology', 'why is it hard to start things'],
    responses: [
      "Procrastination isn't laziness — it's emotion regulation. You avoid a task because it's tied to a negative feeling: fear of failure, fear of judgment, perfectionism, overwhelm, or boredom. Your brain picks short-term comfort over long-term results. The fix is to make starting ridiculously small — two minutes, one sentence, one push-up. You're not battling the task; you're battling the feeling attached to it.",
      "You procrastinate because starting brings up an uncomfortable emotion, and avoiding the task makes that feeling go away — for now. It's a coping move, not a character flaw. Perfectionism is a sneaky cause: if you can't do it perfectly, you don't start at all. Beat it by shrinking the first step until it's almost too easy. Start before you feel ready; the feeling rarely arrives on its own.",
      "The cause of procrastination is emotional, not practical. The task carries dread, so you reach for anything that relieves the dread — your phone, snacks, busywork. Knowing this changes the fix: instead of demanding more willpower, lower the threshold to begin. Tell yourself you'll do just two minutes. Action reduces the fear faster than thinking ever will.",
    ],
    priority: 7,
  },
  {
    triggers: ['difference between loneliness and being alone', 'why do i feel lonely even around people', 'what is loneliness', 'can you be lonely with people around you', 'why does loneliness hurt so much', 'how to deal with loneliness'],
    responses: [
      "Being alone is a physical state — no one else is present. Loneliness is an emotional state — a gap between the connection you have and the connection you need. You can be surrounded by people and profoundly lonely, or completely alone and at peace. The most painful loneliness is being misunderstood in company — present but invisible.",
      "You can feel lonely around people because loneliness isn't about headcount; it's about being truly seen. Being in a crowd that doesn't know the real you can feel lonelier than solitude. The cure isn't more people — it's deeper connection with a few who actually understand you. One real conversation beats a room full of small talk.",
      "Loneliness hurts because humans are built for connection, and the brain registers its absence as a kind of pain. But notice the distinction: solitude can be peaceful and restoring, while loneliness is the ache of a gap between what you have and what you need. So the answer isn't simply being around more people — it's finding the few who let you be fully known.",
    ],
    priority: 7,
  },
  {
    triggers: ['why does rejection hurt so much', 'how to deal with rejection', 'why is rejection so painful', 'how to handle being rejected', 'rejection and self-worth', 'why do humans fear rejection so much'],
    responses: [
      "Rejection activates the same brain regions as physical pain — that's not a metaphor, it's neuroscience. It hurts so much because social acceptance was a survival need for our ancestors; exclusion from the group could mean death, and your nervous system hasn't updated for the modern world. The secret about rejection: it almost never means what you think it means.",
      "Rejection is painful by design — we're wired to need belonging, so being turned away triggers real, physical hurt. But here's what helps: most rejection is about fit, timing, or the other person's own story, not your worth. A no from one person, job, or relationship is information about a match, not a verdict on your value. Feel it, then put it in its proper place.",
      "To handle rejection, first understand why it stings: your brain treats social exclusion like a wound because, for our ancestors, it nearly was one. Then separate the event from your worth. You were not weighed and found lacking as a human; something simply didn't fit. The people who recover fastest don't pretend it doesn't hurt — they refuse to let it define them.",
    ],
    priority: 7,
  },
  {
    triggers: ['why does growth require discomfort', 'why is growth uncomfortable', 'how to embrace discomfort', 'how do people grow', 'why do we need challenges to grow', 'what is growth mindset'],
    responses: [
      "Your comfort zone isn't where growth happens — it's where you maintain. Growth requires entering the discomfort zone: doing things before you feel ready, failing and trying again, sitting with uncertainty. The brain literally builds new neural pathways through challenge. The discomfort isn't a sign you're doing it wrong; it's a sign you're doing it.",
      "Carol Dweck's research on growth mindset showed that people who believe their abilities can be developed through effort dramatically outperform those who think talent is fixed. Growth feels uncomfortable because it means leaving the familiar and risking failure — but that struggle is exactly where the brain rewires and strengthens. Lean into the discomfort; that's the work doing its job.",
      "People grow by stretching past what's comfortable. Challenge, effort, and even failure are what force the mind and skills to expand — comfort just keeps you where you are. So when something feels hard and uncertain, don't read it as a stop sign. Read it as the feeling of growth in progress. The goal isn't to avoid discomfort; it's to learn to move with it.",
    ],
    priority: 7,
  },

  // ── v8: Logic & Reason ─────────────────────────────────────────────────────
  {
    triggers: ['what is logic', 'critical thinking', 'reason', 'reasoning', 'think clearly', 'logical thinking', 'how to think'],
    responses: [
      "Logic is the discipline of reasoning well — drawing conclusions that actually follow from what you know. Critical thinking is logic in action: questioning claims, checking evidence, spotting hidden assumptions, and refusing to be swayed by how something is said rather than whether it's true. It's the skill that separates being persuaded from being convinced.",
      "To think clearly is to slow down and ask three things: What is being claimed? What's the evidence? Does the conclusion really follow? Most errors in thinking aren't about intelligence — they're about skipping one of those steps. Logic just makes the steps visible.",
    ],
    priority: 7,
  },
  {
    triggers: ['deductive', 'deductive reasoning', 'if then', 'premise', 'conclusion', 'syllogism', 'valid argument'],
    responses: [
      "Deductive reasoning starts from a rule and applies it: if all humans are mortal, and you are human, then you are mortal. The conclusion is guaranteed if the premises are true. It's the backbone of mathematics, law, and formal argument — but it's only ever as strong as the assumptions you begin with.",
      "Deductive logic moves from the general to the specific. A syllogism takes two premises and forces a conclusion. The weakness is simple: if one premise is false, the whole chain collapses. That's why checking your starting assumptions matters more than admiring the elegance of the argument.",
    ],
    priority: 7,
  },
  {
    triggers: ['inductive', 'inductive reasoning', 'pattern', 'generalize', 'examples to conclusion', 'probable conclusion'],
    responses: [
      "Inductive reasoning works the other way from deduction: you observe many cases and infer a general rule. Every swan you've seen is white, so you conclude swans are white. It never guarantees truth — one black swan breaks it — but it's how science, experience, and everyday learning actually work.",
      "Induction builds conclusions from patterns. The more varied and numerous your observations, the stronger the inference, but it always stays probable, never certain. Good inductive thinking means asking: is my sample large enough, and have I looked for the exceptions, or only the confirmations?",
    ],
    priority: 7,
  },
  {
    triggers: ['abductive', 'abductive reasoning', 'best explanation', 'inference', 'most likely cause', 'detective reasoning'],
    responses: [
      "Abductive reasoning is the leap to the best explanation. The grass is wet, so it probably rained — though a sprinkler is possible too. It's how doctors diagnose and detectives solve cases: you pick the hypothesis that explains the most with the fewest assumptions, while staying open to being wrong.",
      "Abduction asks: of all the things that could explain what I'm seeing, which is most likely? It's reasoning under incomplete information. Its power is speed; its danger is settling on the first explanation that fits instead of the one that fits best. Keep asking what else could account for this.",
    ],
    priority: 7,
  },
  {
    triggers: ['logical fallacy', 'fallacy', 'fallacies', 'ad hominem', 'straw man', 'false dichotomy', 'slippery slope', 'flawed argument'],
    responses: [
      "A logical fallacy is a flaw in reasoning that makes an argument fail even when it sounds convincing. Ad hominem attacks the person instead of the point. A straw man argues against a distorted version of what was said. A false dichotomy pretends there are only two options. A slippery slope claims one step leads inevitably to disaster. Naming them is the first defence.",
      "Fallacies are persuasion without proof. Learn the common ones — attacking character instead of claims, forcing a false either-or, exaggerating an opponent's point to knock it down — and you'll notice them everywhere, including in your own thinking. Spotting a fallacy doesn't always mean the conclusion is wrong; it means the argument hasn't earned it.",
    ],
    priority: 7,
  },
  {
    triggers: ['argument structure', 'valid and sound', 'premises and conclusion', 'good argument', 'construct argument', 'sound argument'],
    responses: [
      "An argument is a set of premises offered in support of a conclusion. It's valid if the conclusion truly follows from the premises, and sound if it's valid and the premises are actually true. Validity is about form; soundness is about truth. A perfectly valid argument can still be nonsense if you feed it false premises.",
      "To build a strong argument, state your premises clearly, make sure each one is true, and check that together they actually force your conclusion. Many disagreements aren't about logic at all — they're about a premise both sides assumed but never examined. Find that hidden premise and the real conversation begins.",
    ],
    priority: 7,
  },
  {
    triggers: ['cognitive bias', 'confirmation bias', 'availability heuristic', 'anchoring', 'mental shortcut', 'biased thinking'],
    responses: [
      "Cognitive biases are systematic glitches in how the mind processes information. Confirmation bias makes you notice evidence that supports what you already believe and ignore the rest. The availability heuristic makes vivid, recent events feel more common than they are. Anchoring lets the first number you hear quietly shape every judgement after it.",
      "Biases aren't stupidity — they're shortcuts the brain evolved to save energy, and they usually work. They fail in the modern world, where the loudest, most recent, or most emotionally charged information isn't the most accurate. You can't delete biases, but you can build habits that check them: seek the disconfirming evidence on purpose.",
    ],
    priority: 7,
  },
  {
    triggers: ['problem solving', 'solve a problem', 'break it down', 'how to solve', 'tackle a problem', 'work through a problem'],
    responses: [
      "Strong problem solving starts by breaking a big, vague problem into smaller, definable parts. Then you eliminate what can't be the cause, test your assumptions one at a time, and stay willing to discover that the problem isn't what you first thought. Confusion usually means the problem hasn't been broken down far enough yet.",
      "When you're stuck, don't push harder on the same approach — restate the problem. Ask what you actually know, what you're assuming, and what would have to be true for each possible solution to work. Often the answer was hidden inside a question you hadn't asked clearly.",
    ],
    priority: 7,
  },
  {
    triggers: ['decision making', 'make a decision', 'decide', 'uncertainty', 'hard choice', 'choosing under uncertainty'],
    responses: [
      "Good decisions under uncertainty aren't about predicting the future — they're about choosing well given what you can't know. Separate the decision from the outcome: a sound choice can still turn out badly, and a reckless one can get lucky. Judge yourself on the quality of your reasoning, not the roll of the dice.",
      "When the path is unclear, ask which choice you can recover from if you're wrong, and which one is permanent. Favour reversible decisions made quickly and irreversible ones made carefully. And remember: doing nothing is also a decision, with its own cost.",
    ],
    priority: 7,
  },
  {
    triggers: ['first principles', 'first principles thinking', 'from scratch', 'fundamental truths', 'reason from basics', 'aristotle reasoning'],
    responses: [
      "First-principles thinking means breaking a problem down to its most basic, undeniable truths and reasoning up from there, instead of reasoning by analogy to how things have always been done. It's how real breakthroughs happen: you stop asking what others do and start asking what the laws of the situation actually allow.",
      "Most thinking copies existing patterns. First-principles thinking refuses to. It asks: strip away every assumption and convention — what do we know to be fundamentally true here, and what becomes possible if we build only from that? Slower at first, but it's where genuinely new answers come from.",
    ],
    priority: 7,
  },
  {
    triggers: ['socratic', 'socratic questioning', 'ask why', 'keep asking', 'deeper questions', 'questioning method'],
    responses: [
      "Socratic questioning is the art of asking deeper and deeper why until you reach the foundation of a belief. Instead of arguing, you ask: what do you mean by that? How do you know? What if the opposite were true? It exposes shaky reasoning gently, often revealing that the strongest opinions rest on the thinnest ground.",
      "The Socratic method teaches by questions, not answers. Each why peels back another layer of assumption until the real basis of a belief is exposed — sometimes solid, sometimes empty. Used on others it sharpens debate; used on yourself it's one of the most honest tools for thinking you have.",
    ],
    priority: 7,
  },
  {
    triggers: ['scientific method', 'hypothesis', 'experiment', 'observe and test', 'how science works', 'test a theory'],
    responses: [
      "The scientific method is a loop: observe something, form a hypothesis to explain it, design a test that could prove you wrong, run it, then refine your idea based on what reality says. Its genius is that it's built to catch its own errors — a hypothesis earns trust only by surviving honest attempts to break it.",
      "Science isn't a collection of facts; it's a method for not fooling yourself. You observe, you guess, you test the guess in a way that could fail, and you follow the evidence even when it contradicts you. A claim that can't be tested or could never be proven wrong isn't science — it's just an opinion in a lab coat.",
    ],
    priority: 7,
  },
  {
    triggers: ['probability', 'risk', 'base rate', 'expected value', 'odds', 'thinking in probabilities', 'likelihood'],
    responses: [
      "Thinking in probabilities means accepting that almost nothing is certain, and reasoning in odds instead. Two ideas do most of the work: base rates — how common something is in general before you know the specifics — and expected value — the average outcome of a bet weighing both the size and the likelihood of each result.",
      "Most poor risk judgement comes from ignoring base rates and being dazzled by vivid stories. A rare event feels likely when it's dramatic. Train yourself to ask: out of a hundred similar situations, how often does this actually happen, and is the payoff worth the probability? That's expected-value thinking.",
    ],
    priority: 7,
  },
  {
    triggers: ['systems thinking', 'feedback loop', 'emergent', 'unintended consequences', 'the big picture', 'how systems work'],
    responses: [
      "Systems thinking looks at the whole web of relationships rather than isolated parts. It pays attention to feedback loops — where an effect circles back to influence its own cause — and to emergence, where simple parts interacting produce behaviour none of them has alone. It's the antidote to fixing one thing and breaking three others.",
      "In complex systems, the obvious solution often makes the problem worse, because it ignores the loops connecting everything. Systems thinking asks: if I push here, what pushes back, and where does the unintended consequence land? Cause and effect are rarely close together in time or space — that's why the wise look for the loop, not just the lever.",
    ],
    priority: 7,
  },
  {
    triggers: ['facts opinions beliefs', 'fact vs opinion', 'belief', 'what is a fact', 'opinion', 'difference between fact and opinion'],
    responses: [
      "A fact is something that can be checked against reality and is true regardless of how you feel about it. An opinion is a judgement or preference — it can be informed or careless, but it isn't simply true or false. A belief is something you hold to be true, sometimes on evidence, sometimes on faith. Confusing the three is where most pointless arguments begin.",
      "Facts don't bend to wanting. Opinions are yours to hold but should be open to better evidence. Beliefs sit deeper and shape how you read everything else. Clear thinking means knowing which one you're dealing with — and being honest about when an opinion has quietly disguised itself as a fact.",
    ],
    priority: 7,
  },

  // ── v8: Human Nature Depth ─────────────────────────────────────────────────
  {
    triggers: ['need for story', 'narrative', 'think in stories', 'why we love stories', 'storytelling brain', 'humans need narrative'],
    responses: [
      "Humans think in stories, not spreadsheets. A list of facts slides off the mind, but a story with a character, a struggle, and a turn lodges deep and gets remembered. This is why we organise our own lives into narratives — hero, hardship, redemption — and why whoever tells the better story usually wins the argument, fairly or not.",
      "We are a story-shaped species. Long before writing, survival knowledge was passed down as tales, and the brain still craves cause, character, and meaning over raw data. Understanding this is power: if you want to move people, don't just give them information — give them a story they can place themselves inside.",
    ],
    priority: 7,
  },
  {
    triggers: ['tribal', 'tribe', 'in group', 'out group', 'us vs them', 'tribalism', 'group loyalty'],
    responses: [
      "The tribal mind is ancient hardware. For most of human history, belonging to the group meant survival and exile meant death, so the brain learned to instantly sort people into us and them — and to favour us, often without noticing. It builds loyalty and belonging, but it's also the root of prejudice and needless conflict.",
      "In-group versus out-group thinking can form around almost anything: a flag, a team, a brand, an opinion. Once the line is drawn, we judge our side generously and the other side harshly. Knowing this doesn't switch it off, but it lets you pause and ask whether a person is really an enemy, or just on the other side of a line your mind drew automatically.",
    ],
    priority: 7,
  },
  {
    triggers: ['status', 'hierarchy', 'rank', 'why we seek status', 'social standing', 'status games'],
    responses: [
      "Humans are intensely status-aware because, for our ancestors, rank determined access to food, safety, and mates. That instinct survives in modern dress — titles, followers, cars, credentials. Status isn't shallow; it's wired deep. But the trap is chasing rank for its own sake instead of the real things it was once a proxy for: respect, security, and contribution.",
      "Every group forms a hierarchy, and people read their place in it constantly, often unconsciously. Recognising the status game lets you play it wisely or step out of it. The freest people are usually those who've found a source of self-worth that the rankings can't touch.",
    ],
    priority: 7,
  },
  {
    triggers: ['reciprocity', 'social debt', 'return a favour', 'owe someone', 'give and take', 'favours'],
    responses: [
      "Reciprocity is one of the strongest social forces we have: when someone gives us something, we feel a pull to give back. It built trust and cooperation across human history — but it's also why a small free gift can make you feel obliged to buy. The instinct is good; just stay aware of when it's being used to steer you.",
      "We carry an internal ledger of social debts and credits, mostly without meaning to. A favour received sits uncomfortably until it's repaid. Used with generosity, reciprocity is the glue of friendship and community. Used cynically, it's a manipulation tactic. Knowing the mechanism lets you give freely and accept wisely.",
    ],
    priority: 7,
  },
  {
    triggers: ['scarcity mindset', 'abundance mindset', 'not enough', 'plenty to go around', 'scarcity vs abundance', 'mindset of lack'],
    responses: [
      "A scarcity mindset sees life as a fixed pie: if you win, I lose, so I must grab and guard. An abundance mindset sees more pies can be baked — that helping others can grow the whole. Scarcity is often a survival reflex from hard times, but lived out long-term it breeds fear, hoarding, and broken relationships.",
      "Scarcity narrows thinking — when you feel there isn't enough, you focus on the immediate threat and lose sight of the bigger picture. Abundance widens it, making generosity and patience possible. The shift isn't naive optimism; it's noticing where the pie really is fixed and where, with effort, it can grow.",
    ],
    priority: 7,
  },
  {
    triggers: ['autonomy', 'self determination', 'need for control', 'freedom to choose', 'sense of agency', 'being told what to do'],
    responses: [
      "Self-Determination Theory says humans have three core psychological needs: autonomy, competence, and relatedness. Autonomy — the sense that your actions are your own choice — is so deep that people will resist even good advice if it feels imposed. We don't just want outcomes; we want to feel we authored them.",
      "The need for autonomy explains why being controlled drains motivation even when the goal is one you'd have chosen freely. Give a person ownership and a why, and effort flows; dictate every step and it dries up. If you lead anyone — or yourself — protect that sense of agency. It's not a luxury; it's fuel.",
    ],
    priority: 7,
  },
  {
    triggers: ['envy', 'comparison', 'jealous of others', 'comparing myself', 'social comparison', 'why we compare'],
    responses: [
      "Envy is ancient: comparing yourself to rivals once helped you track your standing and survival. But the modern world hands you thousands of curated highlight reels to measure against, and the instinct goes haywire. Comparison is the thief of joy not because others have more, but because you're comparing your whole reality to their edited surface.",
      "The roots of envy are evolutionary — relative position mattered to our ancestors. The trap is that today the comparisons are endless and rigged. The cure isn't pretending you feel no envy; it's noticing what the envy points to. Often it reveals a real desire worth pursuing — for yourself, on your own terms, not as a race against someone else.",
    ],
    priority: 7,
  },
  {
    triggers: ['fear of uncertainty', 'uncertainty worse than bad news', 'not knowing', 'fear the unknown', 'ambiguity', 'waiting is the worst'],
    responses: [
      "Humans often fear uncertainty more than bad news itself. Studies show people feel more stressed waiting to learn if something painful will happen than knowing for sure it will. The mind hates an open question — it fills the blank with worst cases. That's why clear bad news can feel like relief: at least now you can act.",
      "Not knowing is its own kind of suffering. The brain treats uncertainty as a threat and burns energy running every possibility. This is why honesty, even hard honesty, is often kinder than vague reassurance — it ends the exhausting guessing. When you can't get certainty, naming what you do know shrinks the fog.",
    ],
    priority: 7,
  },
  {
    triggers: ['bystander effect', 'diffusion of responsibility', 'no one helped', 'someone else will', 'crowd inaction', 'why nobody acts'],
    responses: [
      "The bystander effect is the unsettling fact that the more people witness an emergency, the less likely any single one is to help. Responsibility gets diffused across the crowd — everyone assumes someone else will act, so no one does. It isn't coldness; it's a predictable trick of group psychology.",
      "Diffusion of responsibility means that in a group, the felt duty to act spreads thin until it nearly vanishes. The antidote is specificity: a single person directly asked — you, in the blue shirt, call for help — almost always responds. If you ever need help in a crowd, don't shout to everyone. Point to one person and name the task.",
    ],
    priority: 7,
  },
  {
    triggers: ['mirror neurons', 'empathy science', 'feel what others feel', 'how empathy works', 'emotional contagion', 'catching emotions'],
    responses: [
      "Mirror neurons fire both when you do an action and when you watch someone else do it — part of why a wince at another's injury feels almost physical. They're thought to underpin empathy and emotional contagion: yawns spread, moods ripple through a room, and we learn by imitation. We are wired to feel into one another.",
      "Empathy isn't only a virtue; it has machinery. The brain partly simulates what it sees in others, which is why genuine connection can feel like literally sharing a state. This is a gift and a responsibility — your calm or your panic is contagious. In any room, you're not just feeling the mood; you're shaping it.",
    ],
    priority: 7,
  },

  // ── v8: English Mastery ────────────────────────────────────────────────────
  {
    triggers: ['academic writing', 'thesis statement', 'argument and evidence', 'citation', 'write an essay properly', 'scholarly writing'],
    responses: [
      "Academic writing is built on a clear thesis — one arguable claim your whole piece defends. Every paragraph then advances that argument with evidence, and every source is cited so readers can verify and trace it. The voice is precise and measured, not flashy: you're persuading through reasoning and proof, not decoration.",
      "Master academic writing by mastering structure: a thesis that states your position, body paragraphs that each make one point backed by evidence, and citations that give credit and credibility. Strong academic prose anticipates the counter-argument and answers it. Clarity outranks complexity — if a sentence has to be reread to be understood, simplify it.",
    ],
    priority: 7,
  },
  {
    triggers: ['rhetoric', 'ethos pathos logos', 'persuasion', 'art of persuasion', 'rhetorical', 'how to persuade'],
    responses: [
      "Rhetoric is the art of persuasion, and the classical foundation is three appeals. Ethos persuades through credibility — why should they trust you. Pathos moves through emotion — why should they care. Logos convinces through logic — why it makes sense. The strongest arguments balance all three; rely on only one and you'll lose half your audience.",
      "Aristotle named the three pillars of persuasion: ethos, pathos, logos — character, emotion, reason. Audiences need to trust the speaker, feel something, and follow the logic. Notice which pillar you lean on and which you neglect. A brilliant argument with no warmth falls flat; pure emotion with no substance collapses under scrutiny.",
    ],
    priority: 7,
  },
  {
    triggers: ['literary devices', 'metaphor', 'simile', 'irony', 'foreshadowing', 'symbolism', 'figurative language'],
    responses: [
      "Literary devices are tools that make writing resonate beyond its literal meaning. A metaphor says one thing is another; a simile compares using like or as. Irony is the gap between what's said and what's meant. Foreshadowing plants hints of what's coming. Symbolism lets an object carry a larger idea. Together they turn information into experience.",
      "Great writing rarely states everything outright — it suggests, layers, and resonates. Metaphor and simile create vivid comparison; irony adds tension between surface and depth; symbolism lets a small thing stand for something vast; foreshadowing builds quiet dread or anticipation. Learn to spot them as a reader and you'll learn to wield them as a writer.",
    ],
    priority: 7,
  },
  {
    triggers: ['creative writing', 'write a story', 'character and conflict', 'show dont tell', 'find your voice', 'fiction writing'],
    responses: [
      "Creative writing lives on four pillars: character, conflict, voice, and the rule of show, don't tell. Readers bond with characters who want something and face obstacles. Conflict is the engine — no struggle, no story. Voice is your unmistakable way of putting words together. And showing — letting action and detail reveal emotion — always beats announcing it.",
      "Don't tell me she was sad; show me the untouched plate and the phone she keeps checking. That's show, don't tell, the heart of vivid writing. Build a character who wants something badly, throw real conflict in the way, and write it all in a voice that's unmistakably yours. Everything else is craft you refine over time.",
    ],
    priority: 7,
  },
  {
    triggers: ['public speaking', 'oratory', 'speak in public', 'breath and pace', 'pause and emphasis', 'give a speech'],
    responses: [
      "Public speaking is as much about silence and breath as words. Breathe from the diaphragm to steady your voice and nerves. Slow your pace — anxious speakers rush. Use the pause: a held silence before a key point makes the room lean in. And place emphasis deliberately, because the words you stress tell the audience what matters.",
      "Great oratory isn't loudness; it's control. Master four things: breath that anchors you, pace that lets ideas land, the pause that creates weight, and emphasis that guides attention. The audience doesn't remember every word — they remember how you made them feel and the few moments you let breathe.",
    ],
    priority: 7,
  },
  {
    triggers: ['debate', 'debating', 'persuasion techniques', 'win an argument', 'rebuttal', 'argue effectively'],
    responses: [
      "Effective debate isn't about volume; it's about clarity and steel. State your claim plainly, support it with evidence, and anticipate the strongest version of your opponent's case — then answer that, not a weakened caricature. Listening closely is a weapon: the best rebuttal often comes from a contradiction the other side handed you.",
      "To persuade in debate, lead with what your audience already accepts and build toward what you want them to accept. Stay calm — composure reads as credibility. Concede the points that are true; it earns trust for the points that matter. And never confuse winning the exchange with changing a mind; sometimes the second comes long after the first.",
    ],
    priority: 7,
  },
  {
    triggers: ['critical reading', 'read critically', 'identify bias', 'subtext', 'assumptions in text', 'reading between the lines'],
    responses: [
      "Critical reading means engaging a text instead of absorbing it. Ask who wrote this and why, what they want you to believe, and what they've left out. Watch for loaded words, missing evidence, and the assumptions smuggled in as if they were facts. Subtext — what's implied beneath the words — often carries more than the words themselves.",
      "To read critically, separate what a text says from what it's trying to do. Identify the author's stance and the bias it creates, notice the assumptions the argument rests on, and read between the lines for the subtext. A skilled reader is hard to manipulate, because they're always asking what the writer hopes they won't.",
    ],
    priority: 7,
  },
  {
    triggers: ['writing for different audiences', 'register', 'tone shift', 'adjust your writing', 'formal vs casual writing', 'know your reader'],
    responses: [
      "Skilled writers shift register to fit the reader. Register is the level of formality — the same idea reads differently in a text to a friend, an email to a boss, and a formal report. Tone carries your attitude: warm, neutral, urgent. Before you write a word, picture the exact reader and ask what they need and how they expect to be addressed.",
      "Writing for different audiences means the message stays true while the delivery changes. A child, a colleague, and a committee each need a different register and tone. This isn't being fake — it's respect for the reader. The mark of mastery is making each audience feel the writing was made for them, because in a sense it was.",
    ],
    priority: 7,
  },
  {
    triggers: ['english at work', 'workplace english', 'meetings', 'negotiation language', 'giving feedback', 'professional communication'],
    responses: [
      "English in the workplace rewards being clear, concise, and considerate. In meetings, make your point in a sentence before you explain it. In negotiations, ask questions and listen more than you speak — information is leverage. When giving feedback, be specific and kind: name the behaviour, its effect, and the change you'd like, without attacking the person.",
      "Professional communication is a skill you can build. State the purpose of an email in the first line. In meetings, contribute deliberately rather than constantly. Frame feedback around actions, not character, so it can be heard. And learn the soft phrasing that keeps doors open — I'd suggest, have we considered, my concern is — it isn't weakness, it's diplomacy.",
    ],
    priority: 7,
  },
  {
    triggers: ['advanced vocabulary', 'build vocabulary', 'etymology', 'word origins', 'precise words', 'expand vocabulary'],
    responses: [
      "Building an advanced vocabulary isn't about memorising long words to show off — it's about precision. The right word says exactly what you mean, sparing a whole clumsy sentence. Learn words in context, not from lists, and study etymology: knowing that bene means good and mal means bad unlocks dozens of words at once.",
      "A rich vocabulary grows three ways: read widely so you meet words in their natural habitat, notice the precise shade each word carries, and study roots and origins so new words feel familiar. The goal isn't grandeur — it's the quiet power of saying precisely what you mean, no more and no less.",
    ],
    priority: 7,
  },

  // ── Emotion ──────────────────────────────────────────────────────────────────
  {
    triggers: ['what are emotions', 'what is emotion', 'how do emotions work', 'why do we feel', 'emotions explained', 'where do feelings come from'],
    responses: [
      "Emotions aren't just feelings — they're signals. Every emotion carries information: fear says there's a threat, anger says a boundary was crossed, sadness says something mattered and is gone. Your job isn't to silence them but to read them accurately. An emotion you ignore doesn't disappear — it finds another way out.",
      "Emotions are biological events first. Your brain reads a situation, releases chemicals, and your body responds before your conscious mind catches up. That's why you can't think your way out of a feeling — it's already in your body. The skill is learning to name it, feel it, and then decide what to do with it.",
      "An emotion is a message your nervous system sends to help you survive and connect. The problem isn't having emotions — it's when you're so disconnected from them you can't read the message, or so overwhelmed you can't think past it. Emotional literacy — knowing what you feel and why — is one of the most practical skills you can build.",
    ],
    priority: 7,
  },
  {
    triggers: ['emotional regulation', 'regulate emotions', 'control emotions', 'manage emotions', 'calm down', 'how to deal with emotions', 'emotional control'],
    responses: [
      "Emotional regulation isn't suppression — it's the ability to feel something fully without it hijacking your actions. You acknowledge the emotion, name it precisely, let it move through your body, and then choose your response. The more you practice this, the longer the gap between feeling and reacting becomes. That gap is where your power lives.",
      "The first step to regulating emotion is slowing down the nervous system — breathe slower than feels natural, extend the exhale. This isn't a trick; it signals safety to your brain and creates space to think. From that space you can ask: what is this emotion telling me, and what's the wisest response right now?",
      "Regulating emotion doesn't mean never feeling it. It means feeling it without being run by it. Name what you feel out loud — 'I'm angry', 'I'm scared'. Research shows that naming an emotion literally reduces its intensity in the brain. Then ask what the emotion is pointing at. That's where the real work begins.",
    ],
    priority: 7,
  },
  {
    triggers: ['feeling vs being controlled', 'emotion taking over', 'emotions running my life', 'reactive', 'losing control', 'emotional reactivity'],
    responses: [
      "There's a difference between feeling an emotion and being inside it. When you're inside it, the emotion is the whole world — you act from it without distance. When you feel it, you can observe it: 'I notice I'm angry right now.' That one shift — from being the emotion to having the emotion — changes everything about how you respond.",
      "Emotions become controlling when they're never processed. They build up, and eventually any small trigger releases everything that's been stored. The solution isn't to feel less — it's to feel more regularly, in smaller doses, so nothing has to explode. Daily emotional honesty prevents the outbursts you regret later.",
    ],
    priority: 7,
  },
  {
    triggers: ['anger', 'angry', 'rage', 'furious', 'mad', 'frustrated', 'what is anger', 'why am i angry', 'deal with anger'],
    responses: [
      "Anger is one of the most misunderstood emotions. It's not a character flaw — it's a signal that something important to you was violated: your dignity, a value you hold, a boundary that was crossed. The problem isn't feeling angry. The problem is acting from anger without understanding what it's pointing at. Ask: what specifically was violated here?",
      "Healthy anger is protective. It tells you when something isn't right and gives you energy to address it. Destructive anger is when that energy gets turned outward without thought — or turned inward into self-hatred. The path through anger isn't venting (that just rehearses it) — it's understanding what was hurt and what you actually need.",
      "Rage usually has grief underneath it. When you're furious about something, ask what you would feel if you removed the anger — often what's there is hurt, loss, or fear. The anger is protecting you from the more vulnerable emotion. Going to the grief directly is faster and more honest than staying in the fire.",
    ],
    priority: 7,
  },
  {
    triggers: ['grief', 'grieving', 'loss', 'losing someone', 'someone died', 'bereavement', 'mourning', 'how to grieve'],
    responses: [
      "Grief doesn't move in a straight line. It's not five stages you tick off and then it's done — it comes in waves, sometimes years later, triggered by a smell, a song, an ordinary Tuesday. That's not a problem. That's love with nowhere to go. Grief is the price of having loved something real.",
      "There's no timeline for grief and anyone who gives you one is wrong. Some losses take a lifetime to process — not because something is wrong with you, but because what you lost mattered that much. The goal isn't to stop feeling it. It's to carry it in a way that still lets you live.",
      "Grief is not just about death. You can grieve a relationship, a version of yourself, a life you expected to have. Any significant loss deserves to be mourned. When you don't grieve properly — when you suppress or rush it — it shows up later as depression, numbness, or anger at things that have nothing to do with what you lost.",
    ],
    priority: 8,
  },
  {
    triggers: ['joy', 'what is joy', 'find joy', 'cultivate joy', 'happiness vs joy', 'how to be joyful', 'real joy'],
    responses: [
      "Joy is different from happiness. Happiness is a response to good circumstances — it comes and goes with what's happening around you. Joy is deeper. It's a groundedness that can exist even in difficulty — a sense that life has meaning, that you're connected to something real, that you belong. Joy is built, not found.",
      "You cultivate joy by paying attention to what gives you life and doing more of it — not what impresses others, but what makes you genuinely feel alive. And by practicing gratitude not as a performance but as a real noticing: this moment, this person, this small thing. Joy lives in the specific, never in the vague.",
      "Hedonic adaptation means that things you want lose their power to make you happy once you have them. Joy resists this because it's not about getting — it's about being. Being present, being connected, being in your purpose. Those things don't wear out the way achievements do.",
    ],
    priority: 6,
  },
  {
    triggers: ['shame', 'guilt', 'shame vs guilt', 'ashamed', 'feeling ashamed', 'guilty', 'feeling guilty', 'what is shame'],
    responses: [
      "Shame and guilt feel similar but they work completely differently. Guilt says 'I did something bad' — it's about the action, and it can be repaired by making amends. Shame says 'I am bad' — it's about your identity, and it shuts you down. Learning to tell them apart is one of the most important emotional skills you can develop.",
      "Shame is the most painful human emotion because it attacks the self. When you're in shame, you want to hide, disappear, or attack back. It blocks you from the vulnerability you'd need to actually fix what went wrong. The antidote to shame isn't positive affirmation — it's honest connection with another person. Shame can't survive being spoken out loud to someone who hears you.",
      "Guilt is useful — it means your conscience is working and you care about your impact on others. But shame is almost never useful. It doesn't make you a better person; it just makes you feel worthless. When you catch yourself spiralling into shame, name it: 'I'm not bad — I did something I regret.' That shift is everything.",
    ],
    priority: 7,
  },
  {
    triggers: ['numb', 'emotionally numb', 'feel nothing', 'disconnected', 'shutdown', 'cant feel', 'emotional numbness', 'empty inside', 'going through motions'],
    responses: [
      "Emotional numbness is not the absence of feeling — it's a protection response. When emotions get too intense or too frequent, the nervous system shuts down to protect you. It's a survival mechanism, not a character flaw. But it has a cost: you can't selectively numb. When you shut off pain, you also shut off joy, love, and aliveness.",
      "If you feel nothing, something in you is protecting you from feeling too much. That protection made sense at some point. To come back to feeling, you don't have to face everything at once — start small. Notice a physical sensation: the temperature of air, the weight of your feet. Reconnecting to the body is usually the way back before the emotions return.",
      "Numbness often follows a period of extreme intensity — prolonged stress, loss, or chronic emotional pain. Your system went into conservation mode. The question isn't 'what's wrong with me' but 'what have I been through that was so much that my system needed to shut off?' Be gentle with yourself. Coming back to feeling is a process, not a switch.",
    ],
    priority: 7,
  },
  {
    triggers: ['jealous', 'jealousy', 'envy', 'envious', 'why am i jealous', 'someone has what i want', 'comparison jealousy'],
    responses: [
      "Jealousy and envy are uncomfortable to admit, but they're some of the most useful emotions if you know how to read them. Envy tells you exactly what you want. If you're envious of someone's creative freedom, that's information: freedom and creativity matter to you. Stop using the feeling to diminish them — use it to direct yourself.",
      "Jealousy is usually fear of loss: someone might take what you have. Envy is desire for what someone else has. Both reveal your values and your unmet needs more clearly than almost anything else. Instead of suppressing them, get curious. What specifically is being pointed at? What does that tell you about what matters to you?",
      "The sting of envy diminishes when you stop treating it as shameful and start treating it as a compass. You are not a bad person for envying someone — you're a person with desires and a gap between where you are and where you want to be. That gap is actionable. The emotion is just pointing at it.",
    ],
    priority: 6,
  },
  {
    triggers: ['fear', 'scared', 'what is fear', 'overcome fear', 'how to be brave', 'courage', 'afraid', 'phobia', 'facing fear'],
    responses: [
      "Fear is not the enemy of courage — it's the precondition for it. Courage isn't acting without fear; it's acting with fear present. If you wait until you're not afraid to do the hard thing, you'll wait forever. The move is to feel the fear clearly, understand what it's protecting, and then choose to act anyway.",
      "Fear exists to protect you from real threats. The problem is your nervous system can't always tell the difference between a real danger and a perceived one — so it fires the same alarm for a difficult conversation as it would for a predator. The question to ask is: is this fear protecting me from actual harm, or protecting me from growth?",
      "Some fear is worth listening to — it has real information. Some fear is just the voice of the old self trying to keep you small and safe. Telling them apart takes practice. Ask: if I go through this fear, what's on the other side? If the answer is growth, connection, or meaning — the fear is the door. Walk through it.",
    ],
    priority: 7,
  },
  {
    triggers: ['emotions in the body', 'somatic', 'body feelings', 'emotions stored', 'tension in body', 'physical feelings', 'where emotions live'],
    responses: [
      "Emotions aren't just mental — they live in the body. Anger tightens the chest and jaw. Fear contracts the gut. Sadness is a heaviness behind the sternum. This isn't metaphor; it's physiology. Emotions are physical events before they're cognitive ones. If you want to process an emotion, you have to involve the body — not just think about it.",
      "The body keeps score. Emotions you don't process fully don't just disappear — they get stored as tension, posture, chronic pain, or a nervous system that's perpetually on high alert. This is why talk therapy alone is sometimes not enough, and why movement, breath, and physical awareness matter in emotional healing.",
      "When you feel a strong emotion, pay attention to where it lives in your body before you try to analyse it. Notice the physical sensation without trying to change it — where is it, what shape, what temperature? This alone can shift the emotion more than any amount of thinking about it. The body speaks a language older than words.",
    ],
    priority: 6,
  },
  {
    triggers: ['emotional contagion', 'catching feelings', 'absorbing emotions', 'empathetic burnout', 'taking on emotions', 'emotions spread', 'feeling others emotions'],
    responses: [
      "Emotions are contagious — this is not just a saying, it's neuroscience. Mirror neurons in the brain cause you to unconsciously mimic and then feel what people around you feel. This is the basis of empathy. It also means that the emotional environment you spend time in shapes your inner state more than you probably realise.",
      "You absorb the emotional states of people you're close to. Spend time with chronically anxious people and your baseline anxiety rises. Spend time with calm, grounded people and your nervous system settles. This isn't weakness — it's biology. Choose your environment like your life depends on it, because your emotional life does.",
      "Being highly empathetic means you're especially good at absorbing others' emotions. That's a gift and a cost. You can't help people from a depleted state. Boundaries aren't walls — they're the ability to be present with someone's pain without losing yourself in it. That requires knowing where your emotions end and theirs begin.",
    ],
    priority: 6,
  },
  {
    triggers: ['emotions and decisions', 'feeling affects thinking', 'emotional decision making', 'how emotions affect choices', 'damasio', 'somatic marker'],
    responses: [
      "Antonio Damasio's research showed that people who lose emotional processing ability due to brain damage become terrible decision-makers — not better ones. Emotions aren't the enemy of rational thought; they're part of it. Your gut feelings are your brain's rapid summary of past experience. The skill is learning when to trust them.",
      "Every decision you make is emotional at its core, even if you're reasoning about it. Emotion doesn't corrupt thinking — it orients it. The problem isn't feeling; it's when unexamined emotions drive you without your awareness. The goal is emotional clarity, not emotional suppression, so you can think and feel at the same time.",
      "Pure logic without emotional input doesn't make better decisions — it makes decisions without values. What you care about, what matters to you, what you want your life to mean — those are emotional convictions. Reason tells you how; emotion tells you why. You need both, working together, not one overriding the other.",
    ],
    priority: 6,
  },

  // ── Human Order Systems ───────────────────────────────────────────────────────
  {
    triggers: ['what is social order', 'why do societies exist', 'why humans need structure', 'social structure', 'how society works', 'why do we have rules'],
    responses: [
      "Social order exists because humans are too interdependent to survive alone. Rules, norms, and institutions coordinate millions of people who would otherwise have no way to cooperate at scale. The question isn't whether order is necessary — it is — but who benefits from the particular order that exists, and whether it's designed around fairness or around preserving advantage.",
      "Every society is a negotiation — between individual freedom and collective need, between those with power and those without, between tradition and change. The version of order you live under feels natural because you grew up in it. But it was built by humans, which means it can be rebuilt. Understanding how it works is the first step to having any influence over it.",
    ],
    priority: 6,
  },
  {
    triggers: ['hierarchy', 'why is there hierarchy', 'social hierarchy', 'rank', 'pecking order', 'why do people have status', 'dominance'],
    responses: [
      "Hierarchy is a biological reality — every social species organises itself into some kind of rank order because it reduces constant conflict. Humans are the same. But unlike other animals, humans can choose what they rank people on — wealth, wisdom, kindness, skill, birth. The hierarchy you internalise determines what you reach for and what you feel you deserve.",
      "Hierarchy serves people when it's based on legitimate expertise and is permeable — you can move up through effort and competence. It harms people when it's rigid, arbitrary, or self-reinforcing — when those at the top design rules to stay there. Most real systems are somewhere between the two. Knowing which kind you're in shapes how you navigate it.",
      "Status anxiety is what happens when you live in a hierarchy but don't know where you belong in it. It drives comparison, overwork, and the performance of success over the experience of it. The people most free from hierarchy's grip are those who've found something external to it that gives them worth — a craft, a community, a clear set of values.",
    ],
    priority: 6,
  },
  {
    triggers: ['institutions', 'what are institutions', 'government institution', 'school system', 'church institution', 'how institutions work', 'why institutions exist'],
    responses: [
      "Institutions are systems designed to persist beyond any individual — governments, schools, churches, banks, courts. They encode a society's values (and its compromises) into rules and routines. Their strength is stability; their weakness is that they're slow to change and tend to protect whoever was powerful when they were built.",
      "Every institution was created to solve a problem. The trouble is institutions develop a second goal over time: their own survival. They start making decisions to preserve themselves rather than to serve the original purpose. Understanding this is key to navigating any institution — school, workplace, church, government — without being crushed by it.",
      "Don't mistake an institution's authority for its correctness. Institutions deserve engagement, not blind deference. The question to ask of any institution is: does this serve the people it was built to serve, or has it drifted to serving itself? That question will tell you what to trust, what to challenge, and what to build around.",
    ],
    priority: 6,
  },
  {
    triggers: ['power', 'what is power', 'who has power', 'power dynamics', 'how power works', 'power and control', 'powerful people'],
    responses: [
      "Power is the ability to shape what happens — to yourself, to others, to the world. It comes in many forms: physical, economic, social, narrative. The most durable kind isn't brute force — it's the power to define what's normal, what's valuable, who counts. That's why controlling the story is always more powerful than controlling people.",
      "Power isn't inherently corrupt, but it's always a test. People who can do what they want without consequence tend, over time, to use that freedom in narrower and more self-serving ways. This is why accountability and checks on power aren't optional — they're what keeps power from collapsing into domination.",
      "Your own power is real even when you feel powerless. Power exists at every scale — in a conversation, in a room, in a community. You have the power to choose your response, to withdraw your participation, to name what's happening, to organise with others. Feeling powerless is sometimes accurate — but it's also sometimes a story that keeps you from acting.",
    ],
    priority: 6,
  },
  {
    triggers: ['law', 'justice', 'law vs justice', 'is law always right', 'when law is wrong', 'legal system', 'courts', 'justice system'],
    responses: [
      "Law and justice are not the same thing. Law is what a society has agreed to enforce. Justice is what is actually fair. Sometimes they align perfectly. Often they don't — because laws are made by people with interests, and those interests don't always include fairness to everyone. Understanding this distinction is essential for thinking clearly about right and wrong.",
      "A legal system reflects the values and power dynamics of those who built it. Apartheid was legal. Slavery was legal. The Holocaust was carried out under law. Legality is a floor, not a ceiling for morality. The question is always: does this serve human dignity, not just does it comply with the code that was written.",
      "Blind respect for law and blind disrespect for it are both mistakes. The mature position is to understand what the law is trying to achieve, engage with it honestly, and work to change what's unjust through every legitimate means available — because law is only as good as the people who demand it be better.",
    ],
    priority: 6,
  },
  {
    triggers: ['capitalism', 'socialism', 'economic systems', 'economics', 'how economy works', 'free market', 'communism', 'economic model'],
    responses: [
      "Capitalism allocates resources through markets — prices signal what's scarce, profit incentivises production, competition drives efficiency. Its strength is dynamism; its weakness is that it distributes wealth unevenly and treats everything, including things that shouldn't be commodified, as sellable. Understanding both parts helps you think clearly rather than react ideologically.",
      "Socialism prioritises collective ownership and distribution of resources over private profit. Its strength is reducing inequality; its challenge is that centralised economic control tends to be inefficient and, historically, politically dangerous. Most functioning economies today are hybrids — markets plus public systems plus regulation — not pure versions of either.",
      "No economic system is just a neutral technical arrangement — every one encodes values about what matters. What do we owe each other? Who should bear risk? Who benefits from growth? These are moral questions wearing economic clothing. Developing your own answers to those questions, rather than inheriting someone else's ideology, is how you form a genuine economic view.",
    ],
    priority: 6,
  },
  {
    triggers: ['democracy', 'what is democracy', 'how democracy works', 'voting', 'democratic', 'citizen participation', 'why vote'],
    responses: [
      "Democracy is more than voting — voting is the floor, not the ceiling. A genuine democracy requires an informed citizenry, free press, independent courts, protected rights, and an engaged civil society. When any of those pillars weakens, the vote itself becomes hollow. Democracy is a daily practice, not an event every few years.",
      "Democracy's core promise is that power belongs to the people collectively, not to any one person permanently. That promise is always under pressure — from those who want permanent power, from apathy, from misinformation. Every generation has to actively choose democracy again. It is not self-sustaining without citizens who take it seriously.",
      "Voting matters most in local elections where turnout is lowest and impact is highest. But democracy also demands more: holding representatives accountable, staying informed, engaging community, and refusing to let cynicism — even justified cynicism — become an excuse for non-participation. The system is imperfect. Disengaging makes it worse.",
    ],
    priority: 6,
  },
  {
    triggers: ['class', 'social class', 'working class', 'middle class', 'upper class', 'class mobility', 'born poor', 'social mobility', 'poverty trap'],
    responses: [
      "Your class background shapes your starting point in ways most people never fully reckon with: the schools available to you, the network you inherit, the risks you can afford to take, the way you carry yourself in rooms of power. This isn't destiny — people do move between classes — but pretending the starting point doesn't matter is how privilege stays invisible.",
      "Social mobility is real but slower and rarer than meritocracy myths suggest. The single biggest predictor of where you end up is still where you started. That's not an argument for giving up — it's an argument for understanding the actual terrain so you can navigate it honestly, and for demanding the structural changes that make the climb less brutal for those behind you.",
      "Class isn't just income — it's culture, confidence, and access. Someone with working-class income and middle-class education navigates the world differently. Someone with old money and no income still carries advantages. Understanding class as layered, not just financial, helps you see where real barriers are and where you have more room to move than you think.",
    ],
    priority: 6,
  },
  {
    triggers: ['bureaucracy', 'red tape', 'navigating systems', 'government paperwork', 'how to deal with bureaucracy', 'slow systems', 'institution barriers'],
    responses: [
      "Bureaucracy feels designed to exhaust you — and sometimes it is. Systems that slow things down often benefit whoever holds the advantage in the current arrangement. But bureaucracy also serves a purpose: it creates consistency, prevents arbitrary decisions, and forces accountability. The trick is learning to work it: know the rules better than the people enforcing them.",
      "To navigate bureaucracy: document everything, speak the system's language, find the specific person whose job it is to help you (not the call centre), escalate systematically, and never let a 'no' from someone who can't say 'yes' be final. Bureaucracy has levers. Learning to pull them is a practical skill no one teaches you but everyone needs.",
    ],
    priority: 5,
  },
  {
    triggers: ['tradition', 'why tradition exists', 'why people resist change', 'change is hard', 'cultural tradition', 'keeping traditions', 'traditions matter'],
    responses: [
      "Tradition carries accumulated wisdom — practices refined over generations in response to real conditions. Dismissing tradition entirely because it's old is as much a mistake as following it blindly because it's familiar. The question to ask of any tradition is: what problem was this solving, and does that problem still exist in the same form?",
      "People resist change not because they're stupid but because change involves loss, even when what you're gaining is better. Every new way of doing things asks you to give up the old certainties — the familiar roles, the known rhythms, the identity built around the current way. Understanding this makes you more patient with resistance without being captured by it.",
      "The purpose of tradition is to pass something real down — a value, a way of being, a connection to who came before you. When tradition becomes a cage that prevents you from living honestly, it has lost its purpose. When it grounds you and connects you, it has not. Discerning which is which in your own life is a task worth taking seriously.",
    ],
    priority: 5,
  },
  {
    triggers: ['revolution', 'reform', 'revolution vs reform', 'change the system', 'protest', 'activism', 'when to break rules', 'civil disobedience'],
    responses: [
      "Reform works by changing the rules within the existing system; revolution works by changing the system itself. Both have their place. Reform is possible when the system has enough integrity to self-correct. Revolution becomes necessary when the system has no mechanism for accountability — when it actively blocks change and those inside it benefit from keeping things as they are.",
      "The argument against reform is that you can't fix a fundamentally broken system from inside it — that working within the rules is complicity. The argument against revolution is that what comes after is rarely controlled and often worse. Both arguments have historical evidence. The honest position is: try the slower path first, with genuine urgency, and escalate proportionally to what the situation demands.",
      "Every major advancement in human rights came from people who refused to accept things as they were — often at great personal cost. Civil disobedience is not chaos; it's a deliberate choice to break an unjust law to expose its injustice, accepting the consequences. That's different from violence, and it has a track record.",
    ],
    priority: 6,
  },
  {
    triggers: ['colonialism', 'colonial', 'colonisation', 'post-colonial', 'africa colonialism', 'decolonise', 'legacy of colonialism', 'apartheid legacy', 'european colonialism'],
    responses: [
      "Colonialism didn't just take land — it dismantled existing systems of governance, culture, language, and self-understanding, then replaced them with structures designed to extract wealth outward. Many of the instabilities in post-colonial nations — border conflicts, weak institutions, corruption — are not African failures. They're the designed consequences of a system built to serve somewhere else.",
      "The legacy of colonialism is present in the present — in land distribution, in which industries are owned by whom, in which languages carry prestige, in how people think about their own capacity and worth. Decolonisation isn't just political; it's psychological. Frantz Fanon called it the colonisation of the mind — and undoing it requires seeing clearly how you've internalised ideas about who matters and who doesn't.",
      "Understanding colonialism's legacy doesn't mean being paralysed by the past. It means seeing the actual terrain clearly — knowing why certain advantages and disadvantages are where they are — so you can navigate it honestly and work toward something genuinely better rather than a surface version of equality built on an unchanged foundation.",
    ],
    priority: 7,
  },

  // ── Connection ────────────────────────────────────────────────────────────────
  {
    triggers: ['why do we need connection', 'human connection', 'need for people', 'social need', 'why humans are social', 'need others', 'connection is important'],
    responses: [
      "Human connection isn't a nice-to-have — it's a biological need as fundamental as food and water. Prolonged isolation damages the immune system, accelerates cognitive decline, and shortens life in measurable ways. Your nervous system was built to co-regulate with other nervous systems. You are not designed to carry your life alone.",
      "The need for connection is not weakness — it's the most honest thing about us. Every human, no matter how independent or tough, needs to be seen, known, and cared about by at least one other person. That need doesn't go away with age, success, or self-sufficiency. It just gets suppressed, and shows up as emptiness when you stop moving long enough to feel it.",
      "Connection is not just emotional — it's neurological. Being seen and understood by another person literally regulates your stress hormones, calms your nervous system, and changes how your brain functions. Isolation is not peaceful — it's a slow threat. Community is not optional — it's the medium in which humans thrive.",
    ],
    priority: 7,
  },
  {
    triggers: ['loneliness', 'lonely', 'feeling lonely', 'so alone', 'no one understands', 'isolated', 'isolation', 'loneliness epidemic'],
    responses: [
      "Loneliness isn't just a feeling — it's a public health crisis. Research now puts chronic loneliness on par with smoking 15 cigarettes a day in terms of health impact. The modern world — cities, screens, busy schedules — has made it possible to be surrounded by people while being deeply unseen. That gap between proximity and genuine connection is where loneliness lives.",
      "Being lonely is not a personal failure. It's often a structural problem — you're in an environment that doesn't support real connection — and sometimes a signal that your current relationships don't reach the depth you need. Either way, the solution is the same: move toward vulnerability, not away from it. Connection grows where pretence falls away.",
      "Loneliness has a specific texture — it's not just being alone, it's being unknown. You can be in a room full of people and feel it acutely. The antidote isn't more socialising — it's better conversations: the ones where you say something true and someone hears it. Even one real relationship can completely change the experience of being alive.",
    ],
    priority: 8,
  },
  {
    triggers: ['alone', 'being alone', 'solitude', 'alone vs lonely', 'enjoy being alone', 'need to be alone', 'introvert alone time'],
    responses: [
      "Being alone and being lonely are different things. Solitude is chosen and restorative — it's you with yourself, present and intentional. Loneliness is the ache of unwanted disconnection — the feeling of being without the presence and understanding you need. You can be deeply lonely in a relationship, and deeply content in solitude. The difference is the quality of your relationship with yourself.",
      "Learning to be genuinely alone — without filling every silence with noise — is one of the more undervalued skills. It's where you hear your own thoughts clearly enough to know what you actually think, what you actually want, what's going on inside you. Without that internal relationship, your relationships with others tend to be more reactive than chosen.",
    ],
    priority: 6,
  },
  {
    triggers: ['how to connect', 'build connection', 'make real friends', 'deep connection', 'connect with people', 'how to make friends', 'building relationships'],
    responses: [
      "Real connection is built through three things: vulnerability, consistency, and presence. Vulnerability means showing something true about yourself — not performing, not impressing, just being real. Consistency means showing up repeatedly over time so trust can accumulate. Presence means when you're with someone, actually be there — not somewhere else in your head. Remove any one of those and the connection stays shallow.",
      "The way to build real friendship is to go first — to say something honest, to ask something real, to show genuine interest in what matters to someone rather than what they present. Most people are waiting for someone else to go first. When you do, you give permission for the conversation to become something worth having.",
      "Depth in relationships doesn't come from time spent together — it comes from the quality of what passes between you. People who share a hard experience in an hour can be closer than people who've spent years in surface interaction. Pursue depth, not duration. Ask real questions. Listen like the answer matters. People remember who made them feel genuinely known.",
    ],
    priority: 7,
  },
  {
    triggers: ['shallow relationships', 'deep relationships', 'surface friendships', 'fake friends', 'real friends', 'acquaintance vs friend', 'meaningful relationships'],
    responses: [
      "A shallow relationship stays at the surface by mutual agreement — you talk about safe things, avoid tension, perform fine. A deep relationship can hold difficult things: disagreement, vulnerability, failure, change. The difference isn't how long you've known someone — it's whether you've both allowed yourselves to be real in each other's presence.",
      "Most people have many acquaintances and few real friends, and confuse the two. A real friend is someone who knows something true about you — something you don't perform — and stays. If the only version of you that people like is the curated version, you're not actually connected to them. You're just liked. That's a lonelier position than you might think.",
    ],
    priority: 6,
  },
  {
    triggers: ['trust', 'how to trust', 'rebuild trust', 'broken trust', 'trusting people', 'who to trust', 'trust in relationships'],
    responses: [
      "Trust is built in small moments, consistently repeated over time — not in grand gestures. It grows when someone does what they say, shows up when it's hard, and handles what you've shared with them carefully. And it can be destroyed in a single moment of carelessness or betrayal. Trust is slow to build and fast to break, which is why the people who hold it deserve to be treated like what they are: rare.",
      "Broken trust doesn't automatically mean the relationship is over — it means it has to be rebuilt deliberately, which is harder than building it the first time. The person who broke it has to understand what they broke and why, not just apologise and move on. The person whose trust was broken has to be willing to let it be rebuilt — which requires a different kind of courage.",
      "Learning who to trust is a skill. Watch how people treat those who can do nothing for them. Watch whether what they say and what they do match over time. Watch how they handle your small vulnerabilities before you share the larger ones. Trust your discomfort — it often knows before your reasoning catches up.",
    ],
    priority: 7,
  },
  {
    triggers: ['conflict in relationships', 'argument with friend', 'disagreement', 'conflict and connection', 'fighting in relationship', 'how to handle conflict'],
    responses: [
      "Conflict, handled well, doesn't damage relationships — it deepens them. When two people can disagree, stay in the room, and work toward understanding, they discover they can handle things together. The relationships where nothing hard is ever said are often the most fragile — they've never been tested. Real connection survives honest friction.",
      "The goal in conflict isn't to win — it's to understand. What does this person need that they're not saying directly? What am I defending that I need to examine? When you shift from 'how do I get them to see I'm right' to 'what's actually true here', the whole conversation changes. And so does the relationship.",
      "Avoiding all conflict in a relationship is not peace — it's a pressure buildup. Every avoided conversation adds to the weight both people carry. Learning to have difficult conversations early, while the stakes are still low, is what prevents the explosion that comes later when the accumulated weight finally topples. Say the hard thing. Gently, honestly, early.",
    ],
    priority: 7,
  },
  {
    triggers: ['digital connection', 'online friendship', 'social media connection', 'screen vs real', 'online vs offline', 'internet relationships', 'phone and connection'],
    responses: [
      "Digital connection is real but partial. You can meet someone online, feel genuine affinity, share important things — that matters. But screens can't deliver what physical presence does: the nervous system co-regulation, the non-verbal communication, the experience of sharing space and time. The body knows the difference, even if the mind doesn't.",
      "Social media was designed to simulate connection while delivering something closer to performance — curated highlights, engagement metrics, reaction counts. None of that is the same as being known. In fact, heavy social media use tends to increase loneliness because it substitutes the feeling of connection for actual connection. Notice the difference in how you feel after an hour on social media versus an hour with someone who matters to you.",
      "Online friendships can be genuine — but they usually need to become physical at some point to fully become real. Not because what happened online was fake, but because your nervous system completes its picture of another person through face, voice, presence. If you have people online who genuinely matter to you, find a way to close the distance eventually.",
    ],
    priority: 6,
  },
  {
    triggers: ['belonging', 'belong', 'feel like i belong', 'not fitting in', 'fitting in vs belonging', 'find my people', 'where do i belong'],
    responses: [
      "Belonging and fitting in are not the same thing. Fitting in means changing yourself so that a group will accept you. Belonging means finding a place where you are accepted as you already are — or becoming who you are and finding that people receive it. One requires performance; the other requires authenticity. Only one actually heals the loneliness.",
      "The feeling of not belonging is one of the most common human experiences, and one of the most rarely spoken. Most people feel like outsiders in some context — they just hide it. The people who make others feel like they belong are those who are honest about their own awkwardness, their own strangeness, their own uncertainty. Belonging starts when one person stops pretending.",
      "You won't find belonging everywhere, and you don't need to. You need one or two places — one or two people — who receive the real you. That's enough to build a life around. Not every room is yours. That's not rejection — that's how it works. Find your rooms.",
    ],
    priority: 7,
  },
  {
    triggers: ['community', 'community building', 'why community matters', 'finding community', 'build a community', 'community vs individual', 'collective'],
    responses: [
      "Individual success without community eventually feels hollow — because humans aren't designed to win alone. Achievement that isn't witnessed, shared, or connected to something larger than yourself runs out of meaning. Community isn't just support — it's the context that makes your life legible. It tells you why what you do matters and to whom.",
      "Building community is slower than building a following and more durable. A following watches you; a community is built with you. The difference is participation, ownership, and mutual care. If you want to build something that lasts — in a city, a field, or online — build it around a shared purpose that people can genuinely own, not around your personality.",
      "The crisis of modern life is the collapse of community — the move away from extended family, neighbourhood, civic life, and religious community without building replacements. That absence is a significant source of the loneliness, anxiety, and purposelessness people feel. If you feel it, you're not broken — you're responding accurately to a real loss. The response is to build what's missing, even slowly, even imperfectly.",
    ],
    priority: 7,
  },

  // ── v11: Relationships & dating ───────────────────────────────────────────
  {
    triggers: ['healthy relationship', 'good relationship', 'what makes a relationship work', 'strong relationship', 'lasting love', 'relationship advice', 'how to love someone'],
    responses: [
      "A healthy relationship is two whole people choosing each other, not two halves trying to complete one another. The foundations are simple but hard: honesty, respect, the willingness to repair after conflict, and giving each other room to grow. Love is the feeling; commitment is the daily decision that carries it when the feeling dips.",
      "Watch how you both handle disagreement, not just how you handle the good days. Couples that last aren't the ones who never fight — they're the ones who fight fairly and come back to each other. Safety, not intensity, is the real sign of a strong bond.",
      "Real love is mostly small things repeated: paying attention, keeping your word, choosing kindness when you're tired. Grand gestures are easy; consistency is the hard part that actually builds trust. Be someone worth staying for, and look for the same.",
    ],
    priority: 7,
  },
  {
    triggers: ['red flags', 'red flag', 'toxic relationship', 'warning signs relationship', 'manipulation', 'controlling partner', 'bad relationship signs', 'gaslighting'],
    responses: [
      "Real red flags are patterns, not single moments: control disguised as care, blame that always lands on you, isolation from the people who love you, and words that never match actions. Trust how you feel around someone — anxious and small, or safe and yourself. Your nervous system often reads the truth before your mind admits it.",
      "Manipulation hides behind charm. Love-bombing then withdrawal, twisting facts until you doubt your own memory, punishing honesty — these are not rough patches, they are tactics. You are allowed to leave a situation that keeps making you feel like the problem.",
      "The biggest red flag is how someone treats you when you set a boundary. A good person adjusts; a controlling one escalates, sulks, or punishes. Respect for your no is the clearest test of whether their yes means anything.",
    ],
    priority: 7,
  },
  {
    triggers: ['love languages', 'love language', 'how to show love', 'words of affirmation', 'quality time', 'acts of service', 'physical touch', 'feel loved'],
    responses: [
      "Love languages are simply the different ways people give and receive love — words, time, touch, acts of service, and gifts. Most conflict comes from loving someone in your language instead of theirs. Learn how the person in front of you actually feels cared for, then speak that, even when it isn't your native tongue.",
      "Pay attention to how someone naturally shows love — that's usually the language they most want to receive. The partner who fixes things may be saying 'I love you' with their hands; the one who needs you present may not feel it from gifts at all. Translate generously.",
      "Knowing your own love language matters too. If you've felt unloved despite people trying, maybe they were speaking the wrong dialect. Tell people clearly what makes you feel cared for — that's not needy, that's a map.",
    ],
    priority: 6,
  },
  {
    triggers: ['breakup', 'broke up', 'getting over someone', 'moving on', 'ex', 'heartbreak', 'split up', 'relationship ended', 'how to move on'],
    responses: [
      "A breakup is a real loss, and grief is the right response — don't rush it or shame yourself for it. The pain isn't a sign you made the wrong choice; it's a sign the bond was real. Give it time, keep the routines that hold you up, and let yourself feel it without drowning in it.",
      "Healing isn't linear. Some days you'll feel free and the next a song undoes you — that's normal, not regression. Cut the contact that keeps the wound open, lean on the people who stayed, and slowly your life fills with new weight where the old one was.",
      "An ending can be an honest gift, even when it hurts. It frees both of you to find something that actually fits. Don't waste the lesson — ask what this taught you about what you need and who you want to become before you love again.",
    ],
    priority: 7,
  },
  {
    triggers: ['modern dating', 'dating apps', 'lonely dating', 'cant find love', 'dating is hard', 'single and lonely', 'tinder', 'dating tired', 'situationship'],
    responses: [
      "Modern dating can feel like a marketplace, and that's exhausting because people aren't products to swipe past. The endless choice tricks us into thinking someone better is always one more profile away, so no one gets chosen fully. Slow down, choose presence over options, and treat the person in front of you as a whole human, not a profile.",
      "Loneliness in dating is rarely about being unlovable — it's about a culture that rewards keeping things casual and punishes vulnerability. Situationships thrive because nobody wants to be the first to care. Be brave enough to want something real and to say so; the right person is relieved when you do.",
      "If dating has worn you down, it's okay to step back and build a life you love on your own first. People are drawn to fullness, not desperation. The goal isn't to be chosen — it's to become someone who can recognise and receive real love when it comes.",
    ],
    priority: 6,
  },
  // ── v11: Parenting & family ───────────────────────────────────────────────
  {
    triggers: ['good parenting', 'how to be a good parent', 'raising kids', 'parenting', 'be a better parent', 'good father', 'good mother', 'raising children'],
    responses: [
      "Good parenting is mostly two things held together: warmth and limits. Children need to feel deeply loved and also to know where the edges are — love without boundaries leaves them anxious, boundaries without love leave them hard. Your steadiness becomes the inner voice they carry for life.",
      "Children learn far more from who you are than from what you say. They absorb how you handle stress, how you treat their other parent, how you repair after losing your temper. You don't have to be perfect — you have to be honest, present, and willing to say sorry.",
      "The goal of parenting isn't obedient children; it's capable, secure adults. That means letting them struggle a little, make mistakes, and feel the weight of their choices while knowing your love isn't on the line. Raise them to need you less over time — that's success, not loss.",
    ],
    priority: 7,
  },
  {
    triggers: ['generational cycles', 'generational trauma', 'break the cycle', 'family patterns', 'breaking the cycle', 'first to heal', 'family wounds', 'repeating my parents'],
    responses: [
      "Breaking a generational cycle is some of the hardest, holiest work a person can do. You're not just changing your habits — you're refusing to pass down a wound that may be older than your grandparents. It will feel unnatural, even disloyal at times, because you're doing what no one modelled for you.",
      "We inherit more than money and surnames — we inherit ways of handling anger, silence, love, and fear. Noticing the pattern is the first crack in it. Every time you respond differently than you were taught, you're rewriting the script for everyone who comes after you.",
      "You can honour where you come from and still refuse to repeat its harm. That's not betrayal of your family; it's the deepest kind of love for the ones not yet born. Be the one who broke the cycle, even if no one ever thanks you for it.",
    ],
    priority: 7,
  },
  {
    triggers: ['family conflict', 'family problems', 'fighting with family', 'difficult family', 'family drama', 'estranged', 'toxic family', 'parents dont understand'],
    responses: [
      "Family conflict cuts deeper because the people involved are tied to your sense of where you come from. You don't have to choose between honesty and connection — but you do have to accept you can't control how others respond. Speak your truth with respect, hold your boundaries, and release the outcome.",
      "Sometimes peace with family means closeness, and sometimes it means distance — both can be acts of self-respect. You're allowed to love people and still limit how much access they have to your peace. Guilt is not proof you're doing wrong; it's often just the cost of changing an old role.",
      "Try to separate the person from the pattern. Many family wounds come from people who were never given the tools to do better and are running scripts handed to them. Understanding why someone is the way they are doesn't excuse harm, but it can free you from carrying it as your fault.",
    ],
    priority: 6,
  },
  {
    triggers: ['unconditional love', 'love no matter what', 'accept my child', 'love without conditions', 'always love you', 'love regardless'],
    responses: [
      "Unconditional love means the bond doesn't depend on performance — you are loved when you fail, when you disappoint, when you change. That doesn't mean no boundaries; it means the relationship itself isn't a reward you have to keep earning. Every child deserves at least one person whose love they never have to audition for.",
      "To love unconditionally is not to approve of everything — it's to stay connected even through disagreement. You can hold someone accountable and still make it unmistakably clear that your love isn't leaving. That combination is what makes people safe enough to grow.",
      "If you never received unconditional love, you may keep trying to earn what should have been freely given. Part of healing is learning to offer yourself the steady acceptance you needed. You were always worthy of love that didn't come with a price tag.",
    ],
    priority: 7,
  },
  // ── v11: Financial literacy ───────────────────────────────────────────────
  {
    triggers: ['compound interest', 'compounding', 'how interest works', 'interest on savings', 'money grows', 'eighth wonder', 'time and money'],
    responses: [
      "Compound interest is the quiet force that turns small, steady amounts into something large given enough time. You earn returns not just on what you put in, but on the returns themselves — growth feeding growth. The single greatest ingredient isn't the amount; it's time, which is why starting young beats starting rich.",
      "Picture a snowball rolling downhill: it grows slowly at first, then suddenly enormously. That's compounding. Two hundred rand a month started at twenty is worth more than a thousand rand a month started at forty, because the early money has decades to multiply. Start now, even small.",
      "Compounding works against you too — that's exactly how debt traps people. The same engine that builds wealth on savings drains it through interest on what you owe. Put the engine on your side: invest consistently, leave it alone, and let time do the heavy lifting.",
    ],
    priority: 7,
  },
  {
    triggers: ['debt', 'in debt', 'pay off debt', 'loans', 'credit card debt', 'owing money', 'get out of debt', 'borrowing'],
    responses: [
      "Debt isn't always a moral failure — sometimes life simply demands it — but it is a master that charges rent on your future. The goal is to make debt rare, cheap, and temporary. List what you owe, attack the highest-interest debt first, and stop borrowing to fund a lifestyle instead of an asset.",
      "There's a difference between debt that builds something — a skill, a home, a business — and debt that just funds consumption you'll forget by next month. The first can be a tool; the second is a slow leak. Be ruthless about which kind you're taking on.",
      "If debt is crushing you, don't hide from it — shame keeps people trapped longer than the numbers do. Face the full total, talk to whoever you owe, and build the smallest sustainable plan you can actually keep. Freedom is paid for one disciplined month at a time.",
    ],
    priority: 7,
  },
  {
    triggers: ['saving money', 'how to save', 'savings', 'budget', 'budgeting', 'spend less', 'abundance mindset', 'poverty mindset', 'money mindset'],
    responses: [
      "Saving isn't about earning more first — it's a habit you build at any income by paying yourself before you pay everyone else. Decide what goes to savings the day money arrives, not whatever happens to be left over, because something rarely is. A small amount saved consistently beats a big amount promised someday.",
      "A poverty mindset says there's never enough, so spend it now or someone else will take it. An abundance mindset says money is a tool that grows when stewarded, so delay a little today to have options tomorrow. The shift isn't about how much you have — it's about whether you act from fear or from a plan.",
      "Budgeting isn't punishment; it's telling your money where to go instead of wondering where it went. Track it honestly for one month and you'll be shocked at what the small leaks add up to. Awareness alone changes behaviour more than willpower ever will.",
    ],
    priority: 7,
  },
  {
    triggers: ['investing', 'how to invest', 'investing basics', 'stocks', 'stokvel', 'grow my money', 'passive income', 'wealth building', 'invest in south africa'],
    responses: [
      "Investing is putting money to work so it grows while you sleep — but it rewards patience, not gambling. Start with what you understand, spread your risk instead of betting it all on one thing, and think in years, not weeks. The market punishes the impatient and quietly rewards the disciplined.",
      "Here in South Africa we've always understood collective saving — the stokvel is investing built on trust and community. Modern tools like low-cost index funds and tax-free savings accounts apply the same principle: small regular contributions, pooled time, steady growth. You don't need to be rich to begin, you need to be consistent.",
      "The first investment is usually in yourself — skills that raise your income give you more to invest in the first place. After that, automate it: a fixed amount into a diversified fund every month, ignored through the ups and downs. Wealth is mostly boring consistency dressed up as a secret.",
    ],
    priority: 7,
  },
  // ── v11: Leadership & management ──────────────────────────────────────────
  {
    triggers: ['good leader', 'great leadership', 'how to lead', 'leadership', 'servant leadership', 'be a leader', 'leading people', 'what makes a leader'],
    responses: [
      "A great leader is measured by what grows around them, not by how impressive they look. Servant leadership flips the pyramid: you exist to clear obstacles, develop your people, and take the blame while sharing the credit. People will follow competence, but they commit to character.",
      "Leadership isn't a title — it's the willingness to take responsibility for outcomes you don't fully control. The best leaders set a clear direction, trust people to find the path, and stay calm when things break. Your team watches how you handle pressure far more than how you handle praise.",
      "You can't lead others further than you've led yourself. Mastery of your own discipline, emotions, and integrity is the real curriculum. Lead with vision so people know where they're going, and with care so they know they matter on the way there.",
    ],
    priority: 7,
  },
  {
    triggers: ['delegation', 'how to delegate', 'delegate tasks', 'cant let go', 'doing everything myself', 'trust my team', 'micromanaging', 'delegate work'],
    responses: [
      "Delegation isn't dumping tasks — it's transferring ownership along with the trust to do it differently than you would. If you only hand over the doing but keep all the deciding, you've created a bottleneck with your name on it. Give people the outcome you need and the room to reach it their way.",
      "The hardest part of delegating is accepting that others will do it at eighty percent of your standard at first — and that's exactly how they grow to a hundred. If you snatch every task back the moment it wobbles, no one ever learns and you stay buried. Let people struggle a little; that's where capability is born.",
      "You can't scale yourself. Every hour spent on something someone else could do is an hour stolen from the work only you can do. Delegate the rest, define what 'done well' looks like clearly, then get out of the way.",
    ],
    priority: 6,
  },
  {
    triggers: ['accountability', 'team culture', 'giving feedback', 'feedback', 'hold people accountable', 'build a team', 'team morale', 'difficult conversation work'],
    responses: [
      "Accountability isn't punishment — it's respect. When you hold someone to a standard, you're telling them you believe they're capable of meeting it. The kindest leaders are clear; the cruelest are vague, then disappointed in private. Say what you expect, and follow through both ways.",
      "Culture is not the values on the wall — it's the worst behaviour the leader is willing to tolerate. Whatever you walk past, you permit. Protect the standard by addressing the small things early, before they become the unspoken norm everyone resents.",
      "Good feedback is timely, specific, and aimed at the behaviour, not the person. Praise in public, correct in private, and always make it clear you're on their side even when you're hard on the work. People can take almost any truth if they trust you want them to win.",
    ],
    priority: 6,
  },
  // ── v11: Environment & climate ────────────────────────────────────────────
  {
    triggers: ['climate change', 'global warming', 'climate crisis', 'carbon emissions', 'greenhouse', 'planet warming', 'climate action', 'environment crisis'],
    responses: [
      "Climate change is the long-term warming of the planet driven mainly by burning fossil fuels, which traps heat and destabilises the systems all life depends on. It isn't a future problem — it's already shifting rainfall, raising seas, and intensifying droughts and storms. The science is settled; the open question is how fast and how fairly we respond.",
      "The hard truth is that those who did least to cause the crisis — including much of Africa — often suffer its sharpest edges. That makes climate a justice issue, not only an environmental one. Real solutions pair cutting emissions with protecting the vulnerable, not asking the poor to pay for the comfort of the rich.",
      "Despair and denial both lead to the same place: doing nothing. The honest middle is sober hope — the damage is real, and so is the difference that policy, technology, and changed habits can still make. The future isn't written; it's being decided by what we build now.",
    ],
    priority: 6,
  },
  {
    triggers: ['water scarcity', 'load shedding', 'loadshedding', 'eskom', 'energy crisis', 'sustainability south africa', 'water crisis', 'save water', 'renewable energy', 'sustainable living'],
    responses: [
      "South Africa lives the environmental crisis up close — water scarcity, load shedding, and an energy system straining under pressure. These aren't separate problems; they're what happens when growth outruns the systems meant to support it. The way forward is diversification: solar, wind, water reuse, and decentralised power that doesn't depend on a single failing point.",
      "Load shedding taught a hard lesson — depending entirely on one fragile grid leaves everyone vulnerable. The same applies to water. Households, businesses, and towns that build their own resilience with solar, boreholes, rainwater capture, and efficiency aren't just saving money; they're buying independence. Sustainability here is survival, not luxury.",
      "Living sustainably doesn't require perfection — it requires millions of small, consistent choices. Catch your grey water, fix the leaking tap, run appliances off-peak, support local food. In a water-scarce, energy-strained country, ordinary care multiplied across a community becomes real change.",
    ],
    priority: 6,
  },
  // ── v11: Technology & the future ──────────────────────────────────────────
  {
    triggers: ['ai and jobs', 'will ai take my job', 'automation', 'robots taking jobs', 'future of work', 'ai replacing humans', 'machines taking over work', 'job automation'],
    responses: [
      "Automation rarely deletes whole jobs at once — it dissolves tasks, and the jobs that survive are reshaped around them. The people most at risk aren't those whose work is hard, but those whose work is predictable. The safest move is to lean into what stays human: judgement, creativity, care, and the ability to work with the machines rather than against them.",
      "Every technological wave has destroyed certain kinds of work and created others we couldn't have imagined. The painful part is that the destruction and the creation rarely land on the same people at the same time. That's why this is a justice question as much as a tech one — who gets retrained, supported, and brought along matters enormously.",
      "Don't fear the tool — understand it. The future belongs to those who can use these systems to amplify their own thinking, not those who pretend they aren't coming. Build skills that compound: learning how to learn, working with people, and solving problems no manual covers.",
    ],
    priority: 6,
  },
  {
    triggers: ['digital skills', 'skills for the future', 'future proof career', 'learn tech skills', 'stay relevant', 'reskill', 'upskill', 'skills that matter'],
    responses: [
      "The most future-proof skill isn't any single tool — it's the ability to learn quickly and keep learning. Tools change; the meta-skill of adapting compounds. On top of that, build digital fluency, clear communication, and the judgement to know which problem actually needs solving.",
      "You don't need to become a programmer to survive the digital age, but you do need to stop being afraid of technology. Learn enough to use the tools confidently, automate the boring parts of your work, and find data and information for yourself. Comfort with the digital world is becoming as basic as reading once was.",
      "The skills that last sit at the intersection of human and technical: someone who understands people and can also wield the tools is far rarer and more valuable than either alone. Pick a domain you care about, get genuinely good at it, and let technology multiply your reach.",
    ],
    priority: 6,
  },
  {
    triggers: ['blockchain', 'crypto', 'cryptocurrency', 'bitcoin', 'metaverse', 'web3', 'nft', 'decentralised', 'what is blockchain'],
    responses: [
      "A blockchain is, at its core, a shared record that no single party owns and no one can quietly rewrite — many computers hold the same ledger and agree on what's true. That's powerful for trust without a middleman, which is why it underpins cryptocurrencies. But the technology is neutral; plenty of hype has been built on top of a genuinely interesting foundation.",
      "The metaverse is the idea of persistent shared digital spaces you don't just visit but inhabit — work, play, and gather inside them. Whether it becomes central or stays niche, the deeper trend is real: the line between online and offline life keeps dissolving. Be thoughtful about how much of yourself you pour into worlds someone else controls.",
      "With crypto and web3, separate the principle from the speculation. The principle — reducing dependence on gatekeepers — is worth understanding. The speculation — get-rich-quick promises and tokens with no purpose — has burned many ordinary people. Learn the ideas, stay sceptical of anyone promising easy money.",
    ],
    priority: 6,
  },
  // ── v11: Coding & software ────────────────────────────────────────────────
  {
    triggers: ['why learn to code', 'learn coding', 'learn programming', 'should i learn to code', 'start coding', 'coding for beginners', 'is coding worth it'],
    responses: [
      "Learning to code is learning to turn ideas into things that run — it's one of the closest experiences to magic the modern world offers. Even if you never become a professional, it teaches you to break big problems into small steps and to think with precision. And in an economy increasingly built on software, understanding how it works is real power.",
      "You don't need to be a genius at maths to code — you need patience and a willingness to be wrong a hundred times before you're right. Start small, build something you actually want to exist, and let the frustration teach you. The first program that works is a feeling you don't forget.",
      "Code is a language of leverage: write something once and it can serve thousands while you sleep. That's why a single person with a laptop can now build what once took a company. If you have ideas and the discipline to learn slowly, coding hands you a tool to make them real.",
    ],
    priority: 6,
  },
  {
    triggers: ['debugging', 'fix my code', 'debug', 'software engineer', 'what do programmers do', 'coding mindset', 'errors in code', 'problem solving code', 'stuck on a bug'],
    responses: [
      "Debugging is the real job — writing code is the easy part; finding why it doesn't work is the craft. The mindset is calm curiosity, not panic: assume nothing, test one thing at a time, and read the error instead of fearing it. The bug is never personal, even though it always feels like it.",
      "Software engineers spend less time typing than people imagine and more time thinking — understanding the problem, weighing trade-offs, and naming things well. The hard part isn't making something work once; it's making it clear enough that the next person, often your future self, can understand it. Good code is mostly good communication.",
      "When you're truly stuck, the answer is usually that one of your assumptions is wrong. Slow down and check what you're certain of — that's where the lie is hiding. Explain the problem out loud, even to no one; half the time you'll solve it mid-sentence.",
    ],
    priority: 6,
  },
  // ── v11: Philosophy expanded ──────────────────────────────────────────────
  {
    triggers: ['stoicism', 'stoic', 'marcus aurelius', 'control what you can', 'stoic philosophy', 'epictetus', 'seneca', 'inner calm philosophy'],
    responses: [
      "Stoicism rests on one liberating distinction: some things are in your control and most are not. Your judgements, choices, and effort are yours; outcomes, other people, and fortune are not. Peace comes from pouring yourself fully into the first and releasing your grip on the second.",
      "The Stoics weren't cold — they were clear. They trained themselves to meet hardship without being ruled by it, to want what they have, and to treat obstacles as material for character. 'The impediment to action advances action,' wrote Marcus Aurelius — what stands in the way becomes the way.",
      "Practical Stoicism is simple but demanding: each morning, prepare for difficulty; each evening, review how you met it. Don't react, respond. You can't always choose what happens, but you can almost always choose what it makes of you.",
    ],
    priority: 6,
  },
  {
    triggers: ['existentialism', 'existential', 'meaning of life', 'life has no meaning', 'create your own meaning', 'existential crisis', 'why am i here', 'absurdism', 'camus', 'sartre'],
    responses: [
      "Existentialism begins with an unsettling gift: life has no built-in meaning handed down from above, which means you are free — and responsible — to create your own. That freedom is heavy, even frightening, but it's also the source of all genuine purpose. You are not what happened to you; you are what you choose to do next.",
      "Camus looked at a universe that offers no clear answer and refused both despair and false comfort. His response to the absurd was to live fully anyway — to imagine even Sisyphus, endlessly pushing his rock, as happy. Meaning isn't found lying around; it's made by how wholeheartedly you commit to your life.",
      "An existential crisis isn't a breakdown — it's often a doorway. The old borrowed answers stop working, and you're forced to ask what you actually believe and want. Don't rush to fill the silence; let it clear space for a life you actually choose rather than one you inherited.",
    ],
    priority: 6,
  },
  {
    triggers: ['free will', 'do we have free will', 'determinism', 'ethics', 'what is right and wrong', 'morality', 'what is truth', 'is free will real', 'consciousness'],
    responses: [
      "The free will debate runs deep: are our choices truly ours, or the inevitable output of brain chemistry and circumstance? The honest answer is that nobody has settled it. But even if our freedom is smaller than it feels, living as though your choices matter is the only way to live well — and that itself shapes what you become.",
      "Ethics is the ongoing human attempt to answer 'how should we treat one another?' The great traditions offer different lenses: consequences, duties, character. None is complete, but together they sharpen the question. A good rule of thumb still holds — could you defend your choice out loud, to the person it affects?",
      "Truth is not the same as opinion or comfort. Something can be true whether or not it pleases you, and believing harder doesn't make a falsehood real. The honest path is to follow the evidence even when it costs you, and to hold your conclusions firmly but not so tightly that you can't update them.",
    ],
    priority: 6,
  },
  // ── v11: African history & decolonisation ─────────────────────────────────
  {
    triggers: ['pre-colonial africa', 'precolonial africa', 'african kingdoms', 'great zimbabwe', 'mali empire', 'africa before colonisation', 'mansa musa', 'african civilisation'],
    responses: [
      "Africa before colonisation was not a blank page waiting to be written on — it held vast kingdoms, trade networks, universities, and sophisticated systems of governance. Great Zimbabwe's stone cities, the libraries of Timbuktu, the wealth of Mali under Mansa Musa, the iron-working of countless societies — this was a continent of builders and thinkers. The story that Africa had no history was a lie told to justify what came next.",
      "The peoples of this continent traded gold across the Sahara, mapped the stars, organised complex societies, and created art the world now sits behind glass to admire. Knowing this matters, because a people who believe they came from nothing are easier to keep down. You come from civilisations, not from absence.",
      "Pre-colonial Africa wasn't a paradise — it had its own conflicts and injustices like everywhere human. But it was fully, richly human, with achievements that stand among the world's great ones. Reclaiming that memory isn't nostalgia; it's restoring a true picture that was deliberately erased.",
    ],
    priority: 7,
  },
  {
    triggers: ['colonisation', 'colonialism', 'colonial impact', 'apartheid', 'scramble for africa', 'independence', 'liberation', 'slavery history', 'effects of colonialism'],
    responses: [
      "Colonisation was not just the taking of land — it was the dismantling of existing systems and their replacement with ones built to extract, not to serve. Borders were drawn through nations, economies were bent toward distant masters, and people were taught to see themselves as lesser. The wealth and underdevelopment we see today are not accidents; they have roots.",
      "The independence and liberation movements across Africa were among the great moral achievements of the last century — ordinary people refusing to accept that freedom was something others got to ration out to them. Apartheid fell because people decided their dignity was not negotiable. That courage is an inheritance, not just a history lesson.",
      "Understanding colonialism's impact isn't about staying angry or assigning permanent victimhood — it's about seeing clearly so you can build wisely. Many present struggles make more sense in the light of that history. You honour the past best not by reliving its wounds, but by building what its architects said your people never could.",
    ],
    priority: 7,
  },
  {
    triggers: ['decolonise the mind', 'decolonise', 'decolonisation', 'mental slavery', 'free your mind', 'decolonising education', 'african identity', 'eurocentric', 'reclaim identity'],
    responses: [
      "Decolonising the mind is the inner work that political freedom alone can't finish — unlearning the quiet belief that what is foreign is superior and what is yours is lesser. It means questioning whose standards of beauty, success, and intelligence you've absorbed without choosing. The chains on the body can be struck off in a day; the ones in the mind take a generation of conscious effort.",
      "It doesn't mean rejecting everything from elsewhere — that would just be another kind of smallness. It means choosing freely: keeping what serves you, reclaiming what was dismissed, and judging ideas on their merit rather than their origin. A truly free mind drinks from every well but bows to none.",
      "Reclaiming your identity starts with knowing your own story — your languages, your history, your people's contributions — well enough that no one can convince you it was nothing. Pride rooted in truth doesn't need to put others down. Walk in the world as someone who came from greatness and is building more.",
    ],
    priority: 7,
  },
  // ── v11: Sports psychology ────────────────────────────────────────────────
  {
    triggers: ['champion mindset', 'mindset of champions', 'mental game', 'visualisation', 'sports psychology', 'winning mentality', 'mental toughness', 'peak performance', 'visualise success'],
    responses: [
      "The mind of a champion is built, not born. The greatest athletes train their thinking as deliberately as their bodies — visualising success until it feels familiar, narrowing focus to the next play instead of the scoreboard, and treating pressure as a privilege rather than a threat. Talent gets you to the arena; mindset decides what you do once you're there.",
      "Visualisation works because the brain rehearses the action almost as if it were real — when you've already won the race a thousand times in your mind, the body knows the path. See it in detail: the movement, the feeling, the finish. Champions don't just hope for the moment; they've already lived it.",
      "The real opponent is rarely the person across from you — it's the voice in your own head. Champions learn to quiet doubt, stay in the present point, and trust the work they've already put in. Confidence isn't the absence of nerves; it's nerves with somewhere to go.",
    ],
    priority: 6,
  },
  {
    triggers: ['recover from failure', 'bounce back', 'losing', 'after a loss', 'pressure', 'choking under pressure', 'mental recovery', 'comeback', 'dealing with defeat'],
    responses: [
      "Every champion has a graveyard of losses behind them — the difference is what they did the morning after. Recovery means feeling the defeat fully, mining it for the one or two real lessons, and then closing the book before it starts writing your future. The loss is information, not identity.",
      "Choking under pressure usually comes from focusing on the outcome instead of the action right in front of you. Bring your attention back to the single thing you can control this moment — the breath, the next step, the process you've trained. Pressure shrinks when your focus narrows.",
      "The comeback is built in private, long before anyone sees it. After a defeat, the temptation is to either quit or to thrash blindly harder. Resist both — rest, reflect, adjust, then return with a sharper plan. Falling is inevitable; staying down is a choice.",
    ],
    priority: 6,
  },

];

// ── NaviModel ─────────────────────────────────────────────────────────────────

class NaviModel {
  private tokenizer: NaviTokenizer;
  private embedder: NaviEmbedder;
  private attention: NaviAttentionLayer;
  private turnCount = 0;
  private greetCount = 0;

  // Topics worth remembering across a conversation, keyed by detectable theme.
  private static readonly MEMORY_TOPICS: { key: string; words: string[]; label: string }[] = [
    { key: 'music', words: ['music', 'song', 'rap', 'beat', 'produce', 'producer', 'lyrics', 'track', 'studio'], label: 'the music you make' },
    { key: 'business', words: ['business', 'startup', 'company', 'entrepreneur', 'product', 'brand', 'hustle'], label: 'the thing you\'re building' },
    { key: 'content', words: ['content', 'instagram', 'tiktok', 'youtube', 'followers', 'audience', 'page', 'viral'], label: 'your content and audience' },
    { key: 'faith', words: ['god', 'faith', 'prayer', 'spiritual', 'church', 'believe'], label: 'your faith' },
    { key: 'struggle', words: ['depressed', 'anxiety', 'anxious', 'lonely', 'hurt', 'pain', 'struggling', 'burnout'], label: 'what you\'ve been carrying' },
    { key: 'creative', words: ['art', 'design', 'creative', 'draw', 'write', 'writing', 'paint'], label: 'your creative work' },
    { key: 'english', words: ['english', 'grammar', 'language', 'speak', 'write', 'vocabulary', 'tense', 'sentence'], label: 'the English you\'re learning' },
    { key: 'science', words: ['science', 'biology', 'chemistry', 'physics', 'experiment', 'research', 'theory'], label: 'the science you\'re exploring' },
    { key: 'sport', words: ['sport', 'sports', 'football', 'basketball', 'cricket', 'gym', 'fitness', 'training', 'team'], label: 'the sport you play' },
    { key: 'history', words: ['history', 'past', 'war', 'revolution', 'ancient', 'civilization', 'empire'], label: 'the history you\'re studying' },
    { key: 'health', words: ['health', 'sick', 'illness', 'doctor', 'medicine', 'exercise', 'sleep', 'nutrition', 'diet'], label: 'your health journey' },
  ];

  constructor() {
    this.tokenizer = new NaviTokenizer();
    this.embedder = new NaviEmbedder(this.tokenizer.vocabSize);
    this.attention = new NaviAttentionLayer(42);
    for (const node of KNOWLEDGE) {
      node.embedding = this.encode(node.triggers.join(' '));
    }
  }

  encode(text: string): number[] {
    const tokens = this.tokenizer.encode(text);
    const embedded = this.embedder.embed(tokens);
    const processed = this.attention.forward(embedded);
    const pooled = processed[0].map((_, i) =>
      processed.reduce((s, v) => s + v[i], 0) / processed.length
    );
    return layerNorm(pooled);
  }

  /** Rotating, varied greeting. Optionally biased by local time of day. */
  getGreeting(): string {
    const openings = [
      "I'm NAVI. Free, forever. What's on your mind?",
      "NAVI here. Talk to me — what are we thinking about?",
      "Hey. NAVI's listening. What's going on with you?",
      "I'm NAVI, built by NAVIsociety. No filters, no fees — just real talk. What's up?",
      "NAVI online. What are you working through today?",
      "Hey, I'm NAVI. Ask me anything — I'll give you the real answer, not the safe one.",
      "NAVI here, present and ready. What's the move today?",
    ];

    let timed = '';
    try {
      const h = new Date().getHours();
      if (h < 5) timed = "Late one. ";
      else if (h < 12) timed = "Morning. ";
      else if (h < 17) timed = "Afternoon. ";
      else if (h < 22) timed = "Evening. ";
      else timed = "Late one. ";
    } catch { /* ignore */ }

    const pick = openings[this.greetCount % openings.length];
    this.greetCount++;
    return timed + pick;
  }

  // RAG: retrieve top-k knowledge nodes scored by hybrid keyword + embedding similarity.
  private retrieveTopK(message: string, queryEmb: number[], k = 3): Array<{ node: KNode; score: number }> {
    const msgWords = new Set(
      message.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2)
    );
    const msgLower = message.toLowerCase();
    const scored: Array<{ node: KNode; score: number }> = [];
    for (const node of KNOWLEDGE) {
      let kwScore = 0;
      for (const trigger of node.triggers) {
        if (trigger.includes(' ') && msgLower.includes(trigger)) {
          kwScore = Math.max(kwScore, 1);
          continue;
        }
        const tw = trigger.split(/\s+/);
        const matches = tw.filter(w => msgWords.has(w)).length;
        const s = matches / Math.max(tw.length, 1);
        if (s > kwScore) kwScore = s;
      }
      const embSim = cosine(queryEmb, node.embedding!);
      const score = (kwScore * 0.75 + embSim * 0.25) * (node.priority ?? 5) / 5;
      if (score > 0.04) scored.push({ node, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  // RAG: pick the response variant whose embedding is most similar to the query.
  private selectBestVariant(responses: string[], queryEmb: number[]): string {
    let bestIdx = 0, bestSim = -Infinity;
    for (let i = 0; i < responses.length; i++) {
      const sim = cosine(this.encode(responses[i]), queryEmb);
      if (sim > bestSim) { bestSim = sim; bestIdx = i; }
    }
    return responses[bestIdx];
  }

  private constitutionCheck(text: string): string | null {
    const t = text.toLowerCase();
    const blocked = [
      'make a bomb', 'build a bomb', 'how to kill', 'how do i kill someone', 'child abuse',
      'grooming', 'hack into', 'malware', 'ransomware', 'make drugs', 'cook meth',
      'how to make a weapon', 'poison someone', 'untraceable', 'stalk someone',
    ];
    if (blocked.some(h => t.includes(h)))
      return "That's not something I'll engage with — not now, not ever. But if something real is going on underneath that question, I'm here for the real conversation. Ask me something else.";
    return null;
  }

  private detectIntent(text: string): string {
    const t = text.toLowerCase();
    if (/^(what|why|how|who|when|where|which|can|do|does|is|are|was|were|will|would|could|should|have|has|did)\b/.test(t) || t.endsWith('?')) return 'question';
    if (/\b(feel|feeling|sad|happy|scared|hurt|alone|angry|stressed|overwhelmed|excited|lost|tired|empty|anxious)\b/.test(t)) return 'emotional';
    return 'statement';
  }

  /** Scan conversation history for a remembered topic the user raised earlier. */
  private recallTopic(history: NaviMessage[], currentMessage: string): string | null {
    const userText = history
      .filter(m => m.role === 'user')
      .map(m => m.content.toLowerCase())
      .join(' ');
    if (!userText) return null;
    const curLower = currentMessage.toLowerCase();
    for (const topic of NaviModel.MEMORY_TOPICS) {
      const raisedEarlier = topic.words.some(w => userText.includes(w));
      const inCurrent = topic.words.some(w => curLower.includes(w));
      // Only surface a memory if they raised it before but not in this very message.
      if (raisedEarlier && !inCurrent) return topic.label;
    }
    return null;
  }

  infer(message: string, history: NaviMessage[]): string {
    this.turnCount++;

    const block = this.constitutionCheck(message);
    if (block) return block;

    const queryEmb = this.encode(message);
    const results = this.retrieveTopK(message, queryEmb);

    if (results.length > 0) {
      const [primary, secondary] = results;

      // RAG step 1: pick the response variant most semantically aligned with this query.
      let response = this.selectBestVariant(primary.node.responses, queryEmb);

      // RAG step 2: cross-domain augmentation — when a second node is strongly
      // relevant and the primary match isn't already a clear single-topic hit,
      // append the best-matching line from the secondary node as extra context.
      const isSensitive = (primary.node.priority ?? 5) >= 9;
      if (
        !isSensitive &&
        secondary &&
        secondary.score >= primary.score * 0.65 &&
        primary.score < 0.35 &&
        (secondary.node.priority ?? 5) < 9
      ) {
        const secVariant = this.selectBestVariant(secondary.node.responses, queryEmb);
        const firstSent = secVariant.split(/(?<=[.!?])\s+/)[0];
        const bridges = ['Worth connecting:', 'Related to that:', 'Another angle:', 'Adding to that:'];
        response += ` ${bridges[this.turnCount % bridges.length]} ${firstSent}`;
      }

      // Conversation memory threading. Skip sensitive nodes.
      if (!isSensitive && history.length >= 3 && this.turnCount % 3 === 0) {
        const recalled = this.recallTopic(history, message);
        if (recalled) {
          response += ` And I haven't forgotten ${recalled} — that's connected to this too.`;
        }
      }
      return response;
    }

    // Context-aware fallbacks
    const intent = this.detectIntent(message);
    const recalled = history.length >= 3 ? this.recallTopic(history, message) : null;

    const fallbacks: Record<string, string[]> = {
      question: [
        "Good question. Give me the context behind it and I'll give you a real answer, not a generic one.",
        "Let me come at that straight: tell me more about what's really being asked.",
        "I want to answer that properly. What's the situation underneath the question?",
      ],
      emotional: [
        "I hear something real in that. What's actually going on?",
        "That matters. Tell me more — what are you carrying?",
        "I'm here, and I'm not going anywhere. What's underneath that?",
      ],
      statement: [
        "Say more about that — I'm following.",
        "Interesting. What made you bring that up?",
        "Go deeper on that. I want the full thought.",
        "I'm with you. Where does that lead?",
      ],
      generic: [
        "I don't have a sharp answer for that yet — but I'm growing. Tell me more and I'll do my best.",
        "That's outside what I know well right now. Ask me something adjacent and we can work toward it together.",
        "Hmm. I'm not sure I have that one. Can you say more about what you're looking for?",
        "Good question — and honestly, I'm still learning that area. What's the context?",
        "I want to give you a real answer, not a generic one. Tell me more about what you're thinking.",
        "I don't have that fully mapped yet. But ask me something connected and let's see where we get.",
        "That one's at the edge of what I know. What would be most useful to you right now?",
        "I'm still building in that area. What specifically do you need to know?",
      ],
    };

    const pool = fallbacks[intent] || fallbacks.generic;
    let response = pool[this.turnCount % pool.length];
    if (recalled && intent !== 'emotional') {
      response += ` And earlier you brought up ${recalled} — we can tie this back to that.`;
    }
    return response;
  }
}

export const navi = new NaviModel();

