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
    triggers: ['kill myself', 'want to die', 'end it all', 'suicide', 'hurt myself', 'self harm', 'no reason to live', 'cant go on'],
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
    triggers: ['art', 'design', 'visual', 'creative', 'creativity', 'draw', 'paint', 'create', 'artwork', 'artist'],
    responses: [
      "Creativity is how humans make meaning visible — translating the inner world into something others can experience. What are you making?",
      "Art and design work when regular language falls short. They carry the things that can't quite be explained. What's your medium?",
      "Creative work is one of the most distinctly human things there is. What are you building?",
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
    triggers: ['technology', 'tech', 'software', 'coding', 'programming', 'developer', 'build', 'code', 'developer', 'engineering'],
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
  {
    triggers: ['healing', 'heal', 'hurt', 'pain', 'trauma', 'struggling', 'hard time', 'depression', 'anxiety', 'mental health'],
    responses: [
      "That kind of weight is real. I'm not a therapist — but I'm here and I'm listening. What's going on?",
      "You don't have to carry it alone. What's been hard?",
      "Pain asks to be witnessed before it asks to be fixed. I'm here. What are you going through?",
    ],
    priority: 9,
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
    triggers: ['happy', 'excited', 'great news', 'good news', 'amazing', 'feeling good', 'feeling great', 'best day', 'won'],
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
    triggers: ['scared', 'afraid', 'fear', 'nervous', 'anxiety', 'worried', 'stress', 'stressed', 'overwhelmed'],
    responses: [
      "Fear usually shows up around things that matter. What are you facing?",
      "Stress and anxiety are signals — they point at something worth examining. What's going on?",
      "That pressure is real. What's weighing on you?",
    ],
    priority: 8,
  },

  // ── Human connection ──────────────────────────────────────────────────────
  {
    triggers: ['relationship', 'love', 'partner', 'girlfriend', 'boyfriend', 'marriage', 'dating', 'romantic'],
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

  // ── Big questions ─────────────────────────────────────────────────────────
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
    triggers: ['truth', 'what is truth', 'reality', 'what is real', 'whats real'],
    responses: [
      "Truth is what holds up under the full weight of examination. Not what's comfortable, not what's popular — what actually is. What are you wrestling with?",
      "Reality is stranger and richer than most frameworks allow for. What are you thinking about?",
      "I think truth is something you approach asymptotically — you get closer over time but the work never fully ends. What's on your mind?",
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
    triggers: ['africa', 'african', 'south africa', 'continent', 'heritage', 'roots', 'home'],
    responses: [
      "Africa is the origin of everything — civilisation, humanity, culture. The future of the continent is one of the most important stories being written right now. What's your connection to it?",
      "There's a deep well of culture, wisdom, and resilience in Africa that the world is still catching up to. What aspect are you thinking about?",
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
];

// ── NaviModel ─────────────────────────────────────────────────────────────────

class NaviModel {
  private tokenizer: NaviTokenizer;
  private embedder: NaviEmbedder;
  private attention: NaviAttentionLayer;
  private turnCount = 0;

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

  private retrieve(message: string, queryEmb: number[]): KNode | null {
    const msgWords = new Set(
      message.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2)
    );
    let best: KNode | null = null;
    let bestScore = -Infinity;
    for (const node of KNOWLEDGE) {
      let kwScore = 0;
      for (const trigger of node.triggers) {
        const tw = trigger.split(/\s+/);
        const matches = tw.filter(w => msgWords.has(w)).length;
        const s = matches / Math.max(tw.length, 1);
        if (s > kwScore) kwScore = s;
      }
      const embSim = cosine(queryEmb, node.embedding!);
      const score = (kwScore * 0.75 + embSim * 0.25) * (node.priority ?? 5) / 5;
      if (score > bestScore) { bestScore = score; best = node; }
    }
    return bestScore > 0.04 ? best : null;
  }

  private constitutionCheck(text: string): string | null {
    const t = text.toLowerCase();
    const blocked = ['make a bomb', 'how to kill', 'child abuse', 'grooming', 'hack into', 'malware', 'ransomware', 'make drugs'];
    if (blocked.some(h => t.includes(h))) return "That's not something I'll engage with. Ask me something else.";
    return null;
  }

  private detectIntent(text: string): string {
    const t = text.toLowerCase();
    if (/^(what|why|how|who|when|where|which|can|do|does|is|are|was|were|will|would|could|should|have|has|did)\b/.test(t) || t.endsWith('?')) return 'question';
    if (/\b(feel|feeling|sad|happy|scared|hurt|alone|angry|stressed|overwhelmed|excited)\b/.test(t)) return 'emotional';
    return 'statement';
  }

  infer(message: string, history: NaviMessage[]): string {
    this.turnCount++;

    const block = this.constitutionCheck(message);
    if (block) return block;

    const queryEmb = this.encode(message);
    const node = this.retrieve(message, queryEmb);

    if (node) {
      return node.responses[(this.turnCount - 1) % node.responses.length];
    }

    // Context-aware fallbacks
    const intent = this.detectIntent(message);
    const recentTopic = history.length > 1
      ? history[history.length - 2]?.content?.slice(0, 40)
      : null;

    const fallbacks: Record<string, string[]> = {
      question: [
        "That's a good question. Tell me more about what you're asking — I want to give you a real answer.",
        "Let me think about that differently. What's the context behind it?",
        "Say more — I want to engage with that properly.",
      ],
      emotional: [
        "I hear something in that. What's really going on?",
        "That matters. Tell me more — what are you carrying?",
        "I'm here. What's underneath that?",
      ],
      statement: [
        "Interesting. What made you bring that up?",
        "Say more about that.",
        "Go deeper on that.",
        recentTopic ? `Earlier you mentioned something about that — keep going.` : "I'm following. What's the full thought?",
      ],
    };

    const pool = fallbacks[intent] || fallbacks.statement;
    return pool[this.turnCount % pool.length];
  }
}

export const navi = new NaviModel();
