import { ApiError, USE_MOCK_BACKEND, request } from './client';
import {
  auctions as auctionFixtures,
  exportGuide,
  mineDashboard,
  products as productFixtures,
  renderProjects,
  shipments as shipmentFixtures,
  virtualTours,
} from './fixtures';
import type {
  AffiliateStats,
  Auction,
  Bid,
  ExportGuideSection,
  MineDashboard,
  Product,
  RenderProject,
  Rfq,
  Session,
  Shipment,
  Texture,
  User,
  UserRole,
  VirtualTour,
  VisualizerRequest,
  VisualizerSuggestion,
} from './types';

const latency = (ms = 420) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const randomId = () => Math.random().toString(36).slice(2, 10);

const AVATAR_COLORS = ['#2E7DF7', '#F5A524', '#22C55E', '#8B5CF6', '#EC4899', '#06B6D4'];

/* ------------------------------------------------------------------ *
 * Auth — phone number + one-time code
 * ------------------------------------------------------------------ */

interface OtpChallenge {
  code: string;
  expiresAt: number;
  attempts: number;
}

/** In-memory OTP store for the mock backend. A real server keeps this in Redis. */
const otpChallenges = new Map<string, OtpChallenge>();
const knownUsers = new Map<string, User>();

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 120_000;
export const OTP_RESEND_SECONDS = 60;
const MAX_OTP_ATTEMPTS = 5;

export interface RequestOtpResult {
  /** Present only while the mock backend is in use, so the flow is testable. */
  devCode?: string;
  expiresInMs: number;
  resendInSeconds: number;
}

export async function requestOtp(phone: string): Promise<RequestOtpResult> {
  if (!USE_MOCK_BACKEND) {
    return request<RequestOtpResult>('/auth/otp', { method: 'POST', body: { phone } });
  }
  await latency(600);
  const code = String(Math.floor(100_000 + Math.random() * 900_000));
  otpChallenges.set(phone, { code, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });
  return { devCode: code, expiresInMs: OTP_TTL_MS, resendInSeconds: OTP_RESEND_SECONDS };
}

export interface VerifyOtpResult extends Session {
  /** True when this phone had no account before, so the app asks for a role. */
  isNewUser: boolean;
}

export async function verifyOtp(phone: string, code: string): Promise<VerifyOtpResult> {
  if (!USE_MOCK_BACKEND) {
    return request<VerifyOtpResult>('/auth/verify', { method: 'POST', body: { phone, code } });
  }
  await latency(500);

  const challenge = otpChallenges.get(phone);
  if (!challenge) throw new ApiError('otp_not_found', 404, 'otp_not_found');
  if (Date.now() > challenge.expiresAt) {
    otpChallenges.delete(phone);
    throw new ApiError('otp_expired', 410, 'otp_expired');
  }
  challenge.attempts += 1;
  if (challenge.attempts > MAX_OTP_ATTEMPTS) {
    otpChallenges.delete(phone);
    throw new ApiError('too_many_attempts', 429, 'too_many_attempts');
  }
  if (challenge.code !== code) {
    throw new ApiError('otp_invalid', 401, 'otp_invalid');
  }
  otpChallenges.delete(phone);

  const existing = knownUsers.get(phone);
  const user: User =
    existing ??
    {
      id: `u-${randomId()}`,
      phone,
      name: '',
      role: 'buyer',
      avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
      affiliateCode: `AS${phone.slice(-4)}${randomId().slice(0, 3).toUpperCase()}`,
      createdAt: new Date().toISOString(),
    };
  knownUsers.set(phone, user);

  return {
    token: `mock-token-${randomId()}`,
    refreshToken: `mock-refresh-${randomId()}`,
    expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    user,
    isNewUser: !existing,
  };
}

export async function completeProfile(input: {
  name: string;
  company?: string;
  role: UserRole;
  user: User;
}): Promise<User> {
  if (!USE_MOCK_BACKEND) {
    return request<User>('/me', {
      method: 'PATCH',
      body: { name: input.name, company: input.company, role: input.role },
    });
  }
  await latency(300);
  const updated: User = {
    ...input.user,
    name: input.name,
    company: input.company,
    role: input.role,
  };
  knownUsers.set(updated.phone, updated);
  return updated;
}

/* ------------------------------------------------------------------ *
 * Marketplace
 * ------------------------------------------------------------------ */

export interface ProductQuery {
  search?: string;
  category?: Product['category'] | 'all';
}

export async function listProducts(query: ProductQuery = {}): Promise<Product[]> {
  if (!USE_MOCK_BACKEND) {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.category && query.category !== 'all') params.set('category', query.category);
    return request<Product[]>(`/products?${params.toString()}`);
  }
  await latency(260);
  const term = query.search?.trim().toLowerCase();
  return productFixtures.filter((product) => {
    const categoryOk =
      !query.category || query.category === 'all' || product.category === query.category;
    if (!categoryOk) return false;
    if (!term) return true;
    return [product.title, product.titleEn, product.code, product.mineName, product.mineNameEn]
      .join(' ')
      .toLowerCase()
      .includes(term);
  });
}

export async function getProduct(id: string): Promise<Product> {
  if (!USE_MOCK_BACKEND) return request<Product>(`/products/${id}`);
  await latency(200);
  const found = productFixtures.find((p) => p.id === id);
  if (!found) throw new ApiError('product_not_found', 404);
  return found;
}

/* ------------------------------------------------------------------ *
 * Auctions
 * ------------------------------------------------------------------ */

/** Mutable copy so bids placed in the mock backend persist for the session. */
const auctionState: Auction[] = auctionFixtures.map((a) => ({ ...a, bids: [...a.bids] }));

export async function listAuctions(): Promise<Auction[]> {
  if (!USE_MOCK_BACKEND) return request<Auction[]>('/auctions');
  await latency(240);
  return auctionState.map(refreshAuctionStatus);
}

export async function getAuction(id: string): Promise<Auction> {
  if (!USE_MOCK_BACKEND) return request<Auction>(`/auctions/${id}`);
  await latency(180);
  const found = auctionState.find((a) => a.id === id);
  if (!found) throw new ApiError('auction_not_found', 404);
  return refreshAuctionStatus(found);
}

/** Recomputes `status` from the clock so a lot closes while the app is open. */
function refreshAuctionStatus(auction: Auction): Auction {
  const now = Date.now();
  const status: Auction['status'] =
    now >= new Date(auction.endsAt).getTime()
      ? 'ended'
      : now < new Date(auction.startsAt).getTime()
        ? 'upcoming'
        : 'live';
  auction.status = status;
  return auction;
}

export async function placeBid(auctionId: string, amount: number, bidderLabel: string): Promise<Auction> {
  if (!USE_MOCK_BACKEND) {
    return request<Auction>(`/auctions/${auctionId}/bids`, { method: 'POST', body: { amount } });
  }
  await latency(350);
  const auction = auctionState.find((a) => a.id === auctionId);
  if (!auction) throw new ApiError('auction_not_found', 404);
  refreshAuctionStatus(auction);
  if (auction.status !== 'live') throw new ApiError('auction_not_live', 409, 'auction_not_live');

  const minimum = auction.currentBid + auction.bidStep;
  if (amount < minimum) throw new ApiError('bid_too_low', 422, 'bid_too_low');

  const bid: Bid = {
    id: `b-${randomId()}`,
    bidderLabel,
    amount,
    placedAt: new Date().toISOString(),
    isMine: true,
  };
  auction.currentBid = amount;
  auction.bids = [bid, ...auction.bids];
  return auction;
}

/* ------------------------------------------------------------------ *
 * Mine & plant
 * ------------------------------------------------------------------ */

export async function getMineDashboard(): Promise<MineDashboard> {
  if (!USE_MOCK_BACKEND) return request<MineDashboard>('/mine/dashboard');
  await latency(300);
  return mineDashboard;
}

/* ------------------------------------------------------------------ *
 * Logistics
 * ------------------------------------------------------------------ */

export async function listShipments(): Promise<Shipment[]> {
  if (!USE_MOCK_BACKEND) return request<Shipment[]>('/shipments');
  await latency(260);
  return shipmentFixtures;
}

export async function getShipment(id: string): Promise<Shipment> {
  if (!USE_MOCK_BACKEND) return request<Shipment>(`/shipments/${id}`);
  await latency(180);
  const found = shipmentFixtures.find((s) => s.id === id);
  if (!found) throw new ApiError('shipment_not_found', 404);
  return found;
}

export async function listVirtualTours(): Promise<VirtualTour[]> {
  if (!USE_MOCK_BACKEND) return request<VirtualTour[]>('/tours');
  await latency(200);
  return virtualTours;
}

/* ------------------------------------------------------------------ *
 * Affiliate
 * ------------------------------------------------------------------ */

export async function getAffiliateStats(code: string): Promise<AffiliateStats> {
  if (!USE_MOCK_BACKEND) return request<AffiliateStats>('/affiliate/stats');
  await latency(280);
  return {
    code,
    link: `https://anbarsang.com/r/${code}`,
    clicks: 1_284,
    leads: 96,
    conversions: 17,
    commissionRate: 0.045,
    earnedTotal: 84_500_000,
    pendingPayout: 21_300_000,
    paidOut: 63_200_000,
    topProducts: [
      { productId: 'p-marmarit-lashtor', title: 'اسلب مرمریت لاشتر', titleEn: 'Lashtar marble slab', earned: 31_400_000 },
      { productId: 'p-onyx-mahallat', title: 'اسلب چینی محلات', titleEn: 'Mahallat onyx slab', earned: 26_900_000 },
      { productId: 'p-travertine-azarshahr', title: 'تراورتن آذرشهر', titleEn: 'Azarshahr travertine', earned: 14_800_000 },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * International trade
 * ------------------------------------------------------------------ */

const rfqState: Rfq[] = [
  {
    id: 'r-4401',
    reference: 'RFQ-4401',
    productTitle: 'تراورتن آذرشهر — اسلب ۲۰ میلی‌متر',
    quantity: 3,
    unit: 'container',
    destinationCountry: 'CN',
    incoterm: 'FOB',
    targetPrice: 1_150_000,
    createdAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
    quotes: 5,
    status: 'quoted',
  },
  {
    id: 'r-4402',
    reference: 'RFQ-4402',
    productTitle: 'تایل دهبید ۶۰×۶۰',
    quantity: 2_400,
    unit: 'm2',
    destinationCountry: 'AE',
    incoterm: 'CIF',
    createdAt: new Date(Date.now() - 1 * 86_400_000).toISOString(),
    quotes: 1,
    status: 'sent',
  },
];

export async function listRfqs(): Promise<Rfq[]> {
  if (!USE_MOCK_BACKEND) return request<Rfq[]>('/rfqs');
  await latency(240);
  return [...rfqState];
}

export type CreateRfqInput = Omit<Rfq, 'id' | 'reference' | 'createdAt' | 'quotes' | 'status'>;

export async function createRfq(input: CreateRfqInput): Promise<Rfq> {
  if (!USE_MOCK_BACKEND) return request<Rfq>('/rfqs', { method: 'POST', body: input });
  await latency(420);
  const rfq: Rfq = {
    ...input,
    id: `r-${randomId()}`,
    reference: `RFQ-${Math.floor(4000 + Math.random() * 5000)}`,
    createdAt: new Date().toISOString(),
    quotes: 0,
    status: 'sent',
  };
  rfqState.unshift(rfq);
  return rfq;
}

export async function getExportGuide(): Promise<ExportGuideSection[]> {
  if (!USE_MOCK_BACKEND) return request<ExportGuideSection[]>('/guides/export');
  await latency(180);
  return exportGuide;
}

/* ------------------------------------------------------------------ *
 * Visualizer
 * ------------------------------------------------------------------ */

/**
 * Scores catalogue stones against the requested style, space and durability.
 * The mock implementation is deterministic so the UI is testable; swapping in
 * the real model only means changing the branch above.
 */
export async function suggestStones(input: VisualizerRequest): Promise<VisualizerSuggestion[]> {
  if (!USE_MOCK_BACKEND) {
    return request<VisualizerSuggestion[]>('/visualizer/suggest', { method: 'POST', body: input });
  }
  await latency(1_400);

  const styleTags: Record<VisualizerRequest['style'], string[]> = {
    modern: ['مدرن', 'مینیمال'],
    classic: ['کلاسیک', 'نما'],
    minimal: ['مینیمال', 'کف'],
    luxury: ['لاکچری', 'نورپذیر'],
    rustic: ['روستیک', 'نما'],
  };
  const spaceTags: Record<VisualizerRequest['space'], string[]> = {
    facade: ['نما'],
    floor: ['کف'],
    wall: ['دیوار داخلی'],
    kitchen: ['آشپزخانه'],
    bathroom: ['دیوار داخلی'],
    stairs: ['پله'],
  };
  const durabilityFloor: Record<VisualizerRequest['durability'], number> = {
    standard: 60,
    high: 80,
    extreme: 100,
  };

  const wanted = new Set([...styleTags[input.style], ...spaceTags[input.space]]);

  return productFixtures
    .map((product) => {
      const strength = Number(String(product.specs.compressiveStrength).replace(/\D/g, '')) || 0;
      const tagMatches = product.tags.filter((tag) => wanted.has(tag)).length;
      const durabilityOk = strength >= durabilityFloor[input.durability];
      const score = Math.min(
        99,
        42 + tagMatches * 18 + (durabilityOk ? 16 : 0) + Math.round(product.rating * 3),
      );
      return {
        productId: product.id,
        title: product.title,
        titleEn: product.titleEn,
        colorHex: product.colorHex,
        matchScore: score,
        reason: buildReason(tagMatches, durabilityOk, 'fa'),
        reasonEn: buildReason(tagMatches, durabilityOk, 'en'),
      } satisfies VisualizerSuggestion;
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 4);
}

function buildReason(tagMatches: number, durabilityOk: boolean, lang: 'fa' | 'en'): string {
  if (lang === 'en') {
    const parts = [
      tagMatches > 1
        ? 'Matches the chosen style and space'
        : tagMatches === 1
          ? 'Partly matches the chosen style'
          : 'A neutral choice for this space',
      durabilityOk ? 'and meets the durability requirement.' : 'but sits below the requested durability.',
    ];
    return parts.join(' ');
  }
  const parts = [
    tagMatches > 1
      ? 'با سبک و فضای انتخابی هم‌خوان است'
      : tagMatches === 1
        ? 'تا حدی با سبک انتخابی هم‌خوان است'
        : 'گزینه‌ای خنثی برای این فضا است',
    durabilityOk ? 'و دوام موردنیاز را تأمین می‌کند.' : 'اما دوام آن کمتر از سطح درخواستی است.',
  ];
  return parts.join(' ');
}

/* ------------------------------------------------------------------ *
 * Renderan — pre-modelled projects and stone textures
 * ------------------------------------------------------------------ */

/** Textures uploaded in this session, kept alongside the catalogue ones. */
const uploadedTextures: Texture[] = [];

export async function listRenderProjects(): Promise<RenderProject[]> {
  if (!USE_MOCK_BACKEND) return request<RenderProject[]>('/renderan/projects');
  await latency(220);
  return renderProjects;
}

/**
 * Every catalogue product doubles as a texture, plus anything a producer has
 * uploaded — this is the library Renderan applies to a project.
 */
export async function listTextures(): Promise<Texture[]> {
  if (!USE_MOCK_BACKEND) return request<Texture[]>('/renderan/textures');
  await latency(220);
  const fromCatalogue: Texture[] = productFixtures.map((product) => ({
    id: `tx-${product.id}`,
    title: product.title,
    titleEn: product.titleEn,
    colorHex: product.colorHex,
    productId: product.id,
    mineName: product.mineName,
    mineNameEn: product.mineNameEn,
    uploadedByMe: false,
  }));
  return [...uploadedTextures, ...fromCatalogue];
}

export interface UploadTextureInput {
  title: string;
  imageUri: string;
  /** Average colour of the image, used to tint the render preview. */
  colorHex: string;
}

export async function uploadTexture(input: UploadTextureInput): Promise<Texture> {
  if (!USE_MOCK_BACKEND) {
    return request<Texture>('/renderan/textures', { method: 'POST', body: input });
  }
  await latency(700);
  const texture: Texture = {
    id: `tx-up-${randomId()}`,
    title: input.title,
    titleEn: input.title,
    colorHex: input.colorHex,
    imageUri: input.imageUri,
    uploadedByMe: true,
  };
  uploadedTextures.unshift(texture);
  return texture;
}
