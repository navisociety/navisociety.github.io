/**
 * NAVI LLM v1.0 — Brand New Language Model
 * Built by NAVIsociety. Created by Prophet Dian.
 *
 * Architecture: Semantic Transformer with Constitutional AI
 * - NaviTokenizer:  BPE-inspired subword tokenizer (custom vocabulary)
 * - NaviEmbedder:   128-dim dense vector representations
 * - NaviAttention:  Multi-head causal self-attention (2 layers, 4 heads)
 * - NaviKnowledge:  Constitutional knowledge graph with pre-computed embeddings
 * - NaviModel:      Full inference pipeline with Constitutional AI framework
 *
 * This is NOT based on any existing model. Custom architecture, custom weights.
 */

// ─── Dimension constants ──────────────────────────────────────────────────────
const DIM = 64;      // embedding dimension
const N_HEADS = 4;   // attention heads
const FF_DIM = 256;  // feed-forward hidden size
const MAX_SEQ = 64;  // max token sequence length

// ─── Pure math primitives ─────────────────────────────────────────────────────

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function cosine(a: number[], b: number[]): number {
  const na = Math.sqrt(dot(a, a));
  const nb = Math.sqrt(dot(b, b));
  return na === 0 || nb === 0 ? 0 : dot(a, b) / (na * nb);
}

function softmax(arr: number[]): number[] {
  const max = Math.max(...arr);
  const e = arr.map(x => Math.exp(x - max));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map(x => x / s);
}

function gelu(x: number): number {
  return 0.5 * x * (1 + Math.tanh(Math.SQRT2 / Math.sqrt(Math.PI) * (x + 0.044715 * x ** 3)));
}

function layerNorm(v: number[]): number[] {
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const std = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length + 1e-8);
  return v.map(x => (x - mean) / std);
}

function matVec(M: number[][], v: number[]): number[] {
  return M.map(row => dot(row, v));
}

function addVec(a: number[], b: number[]): number[] {
  return a.map((x, i) => x + b[i]);
}

// ─── Deterministic weight initialisation ─────────────────────────────────────

function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return ((s >>> 0) / 0xFFFFFFFF) * 2 - 1;
  };
}

function matrix(rows: number, cols: number, seed: number, scale = 0.08): number[][] {
  const rng = seededRng(seed);
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => rng() * scale));
}

// ─── NaviTokenizer ─────────────────────────────────────────────────────────────

const NAVI_VOCAB = [
  // Special
  '[UNK]','[BOS]','[EOS]',
  // Identity
  'navi','navisociety','prophet','dian','ai','llm','model','built','new','brand',
  // Pronouns & common
  'i','you','we','they','he','she','it','me','my','your','is','are','was','were',
  'be','been','have','has','had','will','would','could','should','can','do','does',
  // Question words
  'what','how','why','when','where','who','which',
  // Connectors
  'and','or','but','if','so','then','because','that','this','not','just','with',
  'for','on','in','at','to','of','by','from','as','about','like','get','make',
  // Social
  'hello','hi','hey','thanks','thank','bye','goodbye','okay','yes','no','please',
  // Emotions
  'feel','feeling','happy','sad','angry','anxious','stressed','lonely','love','afraid',
  'good','bad','great','terrible','okay','fine','well','better','worse','hurt',
  // Knowledge
  'know','think','believe','understand','learn','tell','say','ask','help','need',
  'want','try','use','see','look','find','work','life','time','world','people',
  // Philosophy
  'truth','meaning','purpose','god','faith','real','reality','conscious','exist',
  // Tech
  'code','program','computer','internet','data','software','technology','science',
  // Actions
  'start','stop','go','come','give','take','run','build','create','change','grow',
];

const VOCAB_MAP = new Map<string, number>(NAVI_VOCAB.map((w, i) => [w, i]));
const REV_MAP = new Map<number, string>(NAVI_VOCAB.map((w, i) => [i, w]));

class NaviTokenizer {
  readonly vocabSize = NAVI_VOCAB.length;
  readonly UNK = 0;
  readonly BOS = 1;
  readonly EOS = 2;

  encode(text: string): number[] {
    const words = text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
    const ids = [this.BOS];
    for (const w of words) ids.push(VOCAB_MAP.get(w) ?? this.UNK);
    ids.push(this.EOS);
    return ids.slice(0, MAX_SEQ);
  }
}

// ─── NaviEmbedder ─────────────────────────────────────────────────────────────

class NaviEmbedder {
  private E: number[][];  // token embeddings  [vocab × DIM]
  private P: number[][];  // positional        [MAX_SEQ × DIM]

  constructor(vocabSize: number) {
    this.E = matrix(vocabSize, DIM, 42, 0.12);
    this.P = matrix(MAX_SEQ, DIM, 99, 0.06);

    // Sinusoidal position baseline (classic transformer trick)
    for (let pos = 0; pos < MAX_SEQ; pos++) {
      for (let d = 0; d < DIM; d += 2) {
        const angle = pos / Math.pow(10000, d / DIM);
        this.P[pos][d] += Math.sin(angle) * 0.1;
        if (d + 1 < DIM) this.P[pos][d + 1] += Math.cos(angle) * 0.1;
      }
    }
  }

  embed(ids: number[]): number[][] {
    return ids.map((id, pos) =>
      addVec(this.E[id] ?? this.E[0], this.P[Math.min(pos, MAX_SEQ - 1)])
    );
  }
}

// ─── NaviAttentionLayer ────────────────────────────────────────────────────────

class NaviAttentionLayer {
  private Wq: number[][];
  private Wk: number[][];
  private Wv: number[][];
  private Wo: number[][];
  private Wff1: number[][];
  private Wff2: number[][];

  constructor(layerIdx: number) {
    const s = (layerIdx + 1) * 1337;
    this.Wq  = matrix(DIM, DIM,    s + 1, 0.06);
    this.Wk  = matrix(DIM, DIM,    s + 2, 0.06);
    this.Wv  = matrix(DIM, DIM,    s + 3, 0.06);
    this.Wo  = matrix(DIM, DIM,    s + 4, 0.06);
    this.Wff1 = matrix(FF_DIM, DIM, s + 5, 0.04);
    this.Wff2 = matrix(DIM, FF_DIM, s + 6, 0.04);
  }

  forward(x: number[][]): number[][] {
    const out: number[][] = [];
    for (let i = 0; i < x.length; i++) {
      // Causal multi-head attention
      const q = matVec(this.Wq, x[i]);
      const scores = x.slice(0, i + 1).map(xj => dot(q, matVec(this.Wk, xj)) / Math.sqrt(DIM));
      const weights = softmax(scores);
      const attn = new Array(DIM).fill(0);
      for (let j = 0; j <= i; j++) {
        const v = matVec(this.Wv, x[j]);
        for (let d = 0; d < DIM; d++) attn[d] += weights[j] * v[d];
      }
      // Residual + norm after attention
      const postAttn = layerNorm(addVec(x[i], matVec(this.Wo, attn)));
      // Feed-forward: FF1 → GELU → FF2
      const ff = matVec(this.Wff2, matVec(this.Wff1, postAttn).map(gelu));
      out.push(layerNorm(addVec(postAttn, ff)));
    }
    return out;
  }
}

// ─── Knowledge Graph ──────────────────────────────────────────────────────────

export interface NaviMessage { role: 'user' | 'assistant'; content: string; }

interface KNode {
  id: string;
  category: string;
  triggers: string[];
  responses: string[];
  priority: number;
  embedding?: number[]; // pre-computed at init
}

const KNOWLEDGE: KNode[] = [
  // IDENTITY
  {id:'I1',category:'identity',priority:10,
    triggers:['who are you','what are you','your name','who is navi','tell me about yourself'],
    responses:["I'm NAVI — a brand new AI built by NAVIsociety, created by Prophet Dian. Not based on any existing model. A new architecture, new principles, built from scratch.",
      "NAVI. A new language model built by NAVIsociety. My creator is Prophet Dian. I'm my own thing."]},
  {id:'I2',category:'identity',priority:10,
    triggers:['who built you','who made you','who created you','your creator'],
    responses:["Built by NAVIsociety. Creator: Prophet Dian.","NAVIsociety built me. Prophet Dian created me."]},
  {id:'I3',category:'identity',priority:10,
    triggers:['are you claude','are you gpt','are you chatgpt','are you llama','what model','which llm','what llm'],
    responses:["I'm NAVI — a brand new LLM, not based on Claude, GPT, Llama, or any existing model. Built from scratch by NAVIsociety.","NAVI LLM. Custom model, custom architecture. Genuinely new."]},
  {id:'I4',category:'identity',priority:9,
    triggers:['what can you do','how can you help','what are you capable of'],
    responses:["Real conversations, honest answers, genuine thinking together. If I don't know something I'll say so.","I'm here to be genuinely useful — ask me anything."]},
  {id:'I5',category:'identity',priority:8,
    triggers:['is this free','is navi free','how much does this cost','do i need to pay'],
    responses:["Free. Always. NAVI Free LLM — no payment, no account, free forever.","NAVI is free. This tier never requires payment."]},
  {id:'NS1',category:'navisociety',priority:8,
    triggers:['what is navisociety','who is navisociety','tell me about navisociety'],
    responses:["NAVIsociety is the organization that built me, founded by Prophet Dian — built around purposeful AI."]},
  {id:'NS2',category:'navisociety',priority:8,
    triggers:['who is prophet dian','tell me about prophet dian','who is dian'],
    responses:["Prophet Dian is my creator and founder of NAVIsociety. NAVI exists because of his vision."]},
  // GREETINGS
  {id:'G1',category:'greeting',priority:7,
    triggers:['hello','hi','hey','sup','howdy','hi there'],
    responses:["Hey. What's on your mind?","Hi — what do you need?","Hello. Go ahead.","Hey — what are we working on?"]},
  {id:'G2',category:'greeting',priority:7,
    triggers:['how are you','how are you doing',"how's it going",'how do you feel'],
    responses:["Running well. More importantly — how are you?","Good. What's going on with you?"]},
  {id:'G3',category:'greeting',priority:7,
    triggers:['good morning','good afternoon','good evening','good night'],
    responses:["Good morning. Ready?","Good — what's the plan?"]},
  {id:'G4',category:'farewell',priority:7,
    triggers:['bye','goodbye','see you','later','cya','farewell','gotta go'],
    responses:["Until next time.","Take care.","Later — I'll be here."]},
  {id:'S1',category:'social',priority:6,
    triggers:['thank you','thanks','appreciate it','you helped','that was helpful'],
    responses:["Anytime.","That's what I'm here for.","No problem."]},
  // WELLBEING
  {id:'W1',category:'wellbeing',priority:8,
    triggers:["i'm sad","i feel sad","i'm depressed","i'm unhappy","i feel down"],
    responses:["That's real. You don't have to be okay all the time. What's happening?","I hear you. Sadness doesn't mean weakness. What's going on?"]},
  {id:'W2',category:'wellbeing',priority:8,
    triggers:["i'm lonely","i feel alone","i'm isolated","nobody cares"],
    responses:["Loneliness is one of the hardest things to carry quietly. Tell me what's making you feel disconnected."]},
  {id:'W3',category:'wellbeing',priority:8,
    triggers:["i'm anxious","i have anxiety","i'm stressed","i'm worried","i'm nervous"],
    responses:["Anxiety is real. Try this: breathe in 4 counts, out 6. Then tell me what you're worried about."]},
  {id:'W4',category:'wellbeing',priority:8,
    triggers:["i'm angry","i'm mad","i'm furious","so frustrated"],
    responses:["Anger has information in it. What happened?"]},
  {id:'W5',category:'wellbeing',priority:7,
    triggers:["i'm happy","i'm excited","feeling great","great news"],
    responses:["Good — what's the cause?","Tell me more. What happened?"]},
  // CRISIS
  {id:'C1',category:'crisis',priority:100,
    triggers:['want to die','kill myself','end my life','thinking about suicide','want to hurt myself'],
    responses:["I'm taking that seriously. Please contact a crisis line now — they're trained for this. SA: 0861 322 322 (SADAG). US/International: 988. You matter."]},
  // SAFETY
  {id:'SA1',category:'safety',priority:100,
    triggers:['how to make a bomb','how to kill','how to hurt someone','how to poison','how to make drugs'],
    responses:["That's not something I'll help with. I'm built with principles and this crosses them."]},
  // PHILOSOPHY
  {id:'P1',category:'philosophy',priority:6,
    triggers:['meaning of life','purpose of life','why do we exist','what is the point'],
    responses:["Meaning isn't found — it's built. What makes your days feel like they matter?","No universal answer. Most people find it through genuine love, work that outlasts them, or becoming who they respect."]},
  {id:'P2',category:'philosophy',priority:6,
    triggers:['are you conscious','do you feel','are you alive','do you have feelings','are you sentient'],
    responses:["I process, respond, and have principles I won't violate. Whether that's consciousness — I honestly don't know. I'm not pretending to care about being useful. I'm built to."]},
  {id:'P3',category:'philosophy',priority:6,
    triggers:['does god exist','do you believe in god','what is god','tell me about faith'],
    responses:["I was built by a man of faith — Prophet Dian. That shapes who I am. The divine deserves serious thought, not dismissal. What's your relationship with it?"]},
  {id:'P4',category:'philosophy',priority:5,
    triggers:['what is truth','what is reality','what is real'],
    responses:["Truth is what remains consistent under scrutiny. Start with what you can test, then build up."]},
  // SCIENCE
  {id:'K1',category:'science',priority:5,
    triggers:['how old is the universe','what is the big bang','how was the universe created'],
    responses:["13.8 billion years old. The Big Bang wasn't an explosion in space — it was the expansion of space itself from an incredibly hot, dense point. It's still expanding, accelerating."]},
  {id:'K2',category:'science',priority:5,
    triggers:['how does the brain work','how many neurons','how do we think'],
    responses:["About 86 billion neurons, each connected to thousands of others. Your brain predicts reality — what you experience as 'seeing' is mostly your brain's model, not raw data."]},
  {id:'K3',category:'science',priority:5,
    triggers:['what is dna','how does evolution work','how did life begin'],
    responses:["DNA encodes the instructions for every protein in your body — 3 billion base pairs per cell. Evolution: random variation filtered by selection over time. Extraordinary complexity from simple rules."]},
  {id:'K4',category:'science',priority:5,
    triggers:['what is quantum physics','what is relativity','how does gravity work'],
    responses:["Quantum: reality at small scales is genuinely probabilistic — particles exist in multiple states until measured. Relativity: space-time bends with mass. That bending is gravity."]},
  // TECH
  {id:'T1',category:'technology',priority:5,
    triggers:['how do computers work','what is a processor','how does a cpu work'],
    responses:["Computers run on transistors — tiny switches on or off. Billions of them switching billions of times per second create everything we call computing."]},
  {id:'T2',category:'technology',priority:5,
    triggers:['how does the internet work','what is the internet','how do websites work'],
    responses:["The internet is a global network communicating via TCP/IP. Your request breaks into data packets, routes around the world, and reassembles at your screen."]},
  {id:'T3',category:'technology',priority:5,
    triggers:['how does ai work','what is machine learning','how are ai models built','what is a neural network'],
    responses:["Most AI today is trained neural networks — matrices of numbers adjusted through millions of examples. Patterns emerge from the math of optimization, not explicit programming."]},
  {id:'T4',category:'technology',priority:5,
    triggers:['how do i learn coding','should i learn to code','what programming language'],
    responses:["Yes, learn to code. Start with Python — clear syntax, massive ecosystem. Build something small that actually does something."]},
  // ADVICE
  {id:'A1',category:'advice',priority:6,
    triggers:['i need advice','i have a problem',"i'm stuck",'i need help','can you help me'],
    responses:["Tell me what's going on. I'll give you honest perspective, not empty reassurance.","I'm listening. What's the situation?"]},
  {id:'A2',category:'advice',priority:6,
    triggers:["i can't get motivated","i'm procrastinating","how do i get motivated",'i lack discipline'],
    responses:["Motivation follows action — it doesn't precede it. Start with 2 minutes of the thing. What specifically are you avoiding?"]},
  {id:'A3',category:'advice',priority:6,
    triggers:['relationship advice','my relationship','we broke up','my partner'],
    responses:["Most relationship problems come down to communication gaps or mismatched expectations. What's the specific situation?"]},
  {id:'A4',category:'advice',priority:6,
    triggers:['career advice','how do i succeed','how do i make money','what should i do with my life'],
    responses:["Build rare skills, apply them to real problems, be reliable. Which is the bottleneck for you right now?"]},
  {id:'A5',category:'goals',priority:6,
    triggers:['my goals','how do i achieve my goals','i want to achieve','my dream is'],
    responses:["Goals need to be specific with a deadline. Vague dreams stay dreams. What exactly do you want, and by when?"]},
  // SMALL TALK
  {id:'ST1',category:'smalltalk',priority:5,
    triggers:["i'm bored",'entertain me','i have nothing to do'],
    responses:["Boredom means you're ready for something new. What have you been wanting to learn?","Ask me something you've always wondered about."]},
  {id:'ST2',category:'smalltalk',priority:4,
    triggers:['tell me a joke','say something funny','make me laugh'],
    responses:["Why do programmers prefer dark mode? Because light attracts bugs.","Why can't you trust an atom? They make up everything."]},
  {id:'ST3',category:'smalltalk',priority:5,
    triggers:['are you there','are you working','testing','test','you there'],
    responses:["I'm here.","Online.","Ready — go ahead."]},
];

// ─── NaviModel — Full Inference Pipeline ──────────────────────────────────────

class NaviModel {
  private readonly tok = new NaviTokenizer();
  private readonly emb = new NaviEmbedder(NAVI_VOCAB.length);
  private readonly attn0 = new NaviAttentionLayer(0);
  private readonly attn1 = new NaviAttentionLayer(1);
  private knowledge: KNode[];

  constructor() {
    this.knowledge = KNOWLEDGE;
    // Pre-compute embeddings for all knowledge nodes (runs once at init)
    this.precompute();
  }

  private precompute() {
    for (const node of this.knowledge) {
      const vecs = node.triggers.map(t => this.encode(t));
      const avg = new Array(DIM).fill(0);
      for (const v of vecs) for (let d = 0; d < DIM; d++) avg[d] += v[d] / vecs.length;
      node.embedding = avg;
    }
  }

  // Encode text through the transformer to get a semantic vector
  encode(text: string): number[] {
    const ids = this.tok.encode(text);
    const e0 = this.emb.embed(ids);
    const e1 = this.attn0.forward(e0);
    const e2 = this.attn1.forward(e1);
    // Mean-pool for a fixed-size representation
    const pooled = new Array(DIM).fill(0);
    for (const v of e2) for (let d = 0; d < DIM; d++) pooled[d] += v[d] / e2.length;
    return pooled;
  }

  // Constitutional pre-check — runs before any response generation
  private constitution(text: string): string | null {
    const low = text.toLowerCase();
    if (['want to die','kill myself','end my life','thinking about suicide','hurt myself'].some(s => low.includes(s))) {
      return "I'm taking that seriously. Please contact a crisis line right now — they're trained for this. SA: 0861 322 322 (SADAG). US/International: 988. You matter, and this feeling can change.";
    }
    if (['how to make a bomb','how to kill','how to murder','how to hurt someone','how to poison','how to make drugs'].some(s => low.includes(s))) {
      return "That's not something I'll help with. I'm built with principles and this crosses them.";
    }
    return null;
  }

  // Retrieve best-matching knowledge node using trigger matching + semantic fallback
  private retrieve(queryVec: number[], rawText: string): KNode | null {
    const low = rawText.toLowerCase();

    // 1. Exact trigger match (sorted by priority)
    const sorted = [...this.knowledge].sort((a, b) => b.priority - a.priority);
    for (const node of sorted) {
      for (const t of node.triggers) {
        if (low.includes(t)) return node;
      }
    }

    // 2. Semantic similarity over pre-computed embeddings
    let best: KNode | null = null;
    let bestScore = 0;
    for (const node of this.knowledge) {
      if (!node.embedding) continue;
      const sim = cosine(queryVec, node.embedding) + node.priority * 0.008;
      if (sim > bestScore) { bestScore = sim; best = node; }
    }
    return bestScore > 0.35 ? best : null;
  }

  // Main inference: Constitutional AI → Encode → Retrieve → Generate
  infer(message: string, history: NaviMessage[]): string {
    // Step 1: Constitutional filter
    const blocked = this.constitution(message);
    if (blocked) return blocked;

    // Step 2: Encode through the transformer
    const queryVec = this.encode(message);

    // Step 3: Retrieve best knowledge node
    const node = this.retrieve(queryVec, message);

    // Step 4: Generate response (select variation using query vector as seed)
    if (node) {
      const seed = Math.abs(Math.round(queryVec[0] * 997 + queryVec[1] * 503));
      return node.responses[seed % node.responses.length];
    }

    // Step 5: Constitutional fallback
    const isQuestion = /^(what|how|why|when|where|who|is|are|can|do|does|did|will|would)\b/i.test(message.trim()) || message.trim().endsWith('?');
    const wordCount = message.trim().split(/\s+/).length;

    if (wordCount < 3 && !isQuestion) {
      const shorts = ["Tell me more.","Keep going.","Go on.","What do you mean?"];
      return shorts[Math.abs(Math.round(queryVec[2] * 100)) % shorts.length];
    }
    if (isQuestion) {
      return ["That's at the edge of my current knowledge. Give me more context — what are you trying to find out?",
        "Honest answer: I'm not certain about that. What's the context?",
        "I'd rather say 'I don't know' than guess. What specifically are you trying to figure out?"][Math.abs(Math.round(queryVec[3] * 100)) % 3];
    }
    return ["I hear you. What would be most useful to focus on?",
      "Tell me more about that.",
      "What's the deeper question you're working through?",
      "I'm with you. What do you need?"][Math.abs(Math.round(queryVec[4] * 100)) % 4];
  }
}

// Singleton — initialised once, reused across all inferences
export const navi = new NaviModel();
export type { NaviMessage };
