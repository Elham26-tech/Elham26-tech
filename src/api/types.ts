export type UserRole = 'producer' | 'buyer' | 'marketer';

export interface User {
  id: string;
  phone: string;
  name: string;
  company?: string;
  role: UserRole;
  avatarColor: string;
  affiliateCode: string;
  createdAt: string;
}

export interface Session {
  token: string;
  refreshToken: string;
  expiresAt: string;
  user: User;
}

export type StoneCategory = 'block' | 'slab' | 'tile' | 'crushed';
export type SurfaceFinish = 'polished' | 'honed' | 'leather' | 'flamed' | 'bushhammered';

export interface StoneSpecs {
  dimensions: string;
  thicknessMm: number;
  waterAbsorption: string;
  compressiveStrength: string;
  finish: SurfaceFinish;
}

export interface Product {
  id: string;
  code: string;
  title: string;
  titleEn: string;
  category: StoneCategory;
  colorHex: string;
  pricePerUnit: number;
  unit: 'm2' | 'ton';
  minOrder: number;
  stockQuantity: number;
  mineId: string;
  mineName: string;
  mineNameEn: string;
  city: string;
  rating: number;
  specs: StoneSpecs;
  tags: string[];
  imageUrl?: string;
}

export type AuctionStatus = 'live' | 'upcoming' | 'ended';

export interface Bid {
  id: string;
  bidderLabel: string;
  amount: number;
  placedAt: string;
  isMine: boolean;
}

export interface Auction {
  id: string;
  lotCode: string;
  title: string;
  titleEn: string;
  colorHex: string;
  status: AuctionStatus;
  startingPrice: number;
  currentBid: number;
  bidStep: number;
  volumeM3: number;
  mineName: string;
  mineNameEn: string;
  endsAt: string;
  startsAt: string;
  bids: Bid[];
}

export interface InventoryItem {
  id: string;
  batchCode: string;
  category: StoneCategory;
  quantity: number;
  unit: 'm2' | 'ton' | 'pcs';
  grade: 'A' | 'B' | 'C';
  extractedAt: string;
  status: 'raw' | 'processing' | 'ready' | 'reserved';
}

export interface ProductionPoint {
  label: string;
  labelEn: string;
  output: number;
  capacity: number;
}

export interface WorkOrder {
  id: string;
  code: string;
  title: string;
  titleEn: string;
  assignee: string;
  due: string;
  progress: number;
  priority: 'low' | 'normal' | 'high';
}

export interface MineDashboard {
  inventory: InventoryItem[];
  production: ProductionPoint[];
  workOrders: WorkOrder[];
  efficiency: number;
  monthlyOutputTons: number;
}

export type ShipmentStageKey =
  | 'order'
  | 'extraction'
  | 'processing'
  | 'transport'
  | 'customs'
  | 'delivery';

export interface ShipmentStage {
  key: ShipmentStageKey;
  status: 'done' | 'active' | 'pending';
  at?: string;
  note?: string;
  noteEn?: string;
}

export interface Shipment {
  id: string;
  trackingCode: string;
  productTitle: string;
  productTitleEn: string;
  origin: string;
  originEn: string;
  destination: string;
  destinationEn: string;
  carrier: string;
  carrierEn: string;
  weightTons: number;
  eta: string;
  international: boolean;
  stages: ShipmentStage[];
}

export interface VirtualTour {
  id: string;
  mineName: string;
  mineNameEn: string;
  city: string;
  cityEn: string;
  scenes: number;
  coverColor: string;
}

export interface AffiliateStats {
  code: string;
  link: string;
  clicks: number;
  leads: number;
  conversions: number;
  commissionRate: number;
  earnedTotal: number;
  pendingPayout: number;
  paidOut: number;
  topProducts: { productId: string; title: string; titleEn: string; earned: number }[];
}

export type Incoterm = 'EXW' | 'FOB' | 'CFR' | 'CIF' | 'DAP';

export interface Rfq {
  id: string;
  reference: string;
  productTitle: string;
  quantity: number;
  unit: 'm2' | 'ton' | 'container';
  destinationCountry: string;
  incoterm: Incoterm;
  targetPrice?: number;
  notes?: string;
  createdAt: string;
  quotes: number;
  status: 'sent' | 'quoted' | 'closed';
}

export interface ExportGuideSection {
  id: string;
  title: string;
  titleEn: string;
  body: string;
  bodyEn: string;
}

export type VisualizerStyle = 'modern' | 'classic' | 'minimal' | 'luxury' | 'rustic';
export type VisualizerSpace = 'facade' | 'floor' | 'wall' | 'kitchen' | 'bathroom' | 'stairs';
export type DurabilityLevel = 'standard' | 'high' | 'extreme';

export interface VisualizerRequest {
  style: VisualizerStyle;
  space: VisualizerSpace;
  durability: DurabilityLevel;
  photoUri?: string;
}

export interface VisualizerSuggestion {
  productId: string;
  title: string;
  titleEn: string;
  colorHex: string;
  matchScore: number;
  reason: string;
  reasonEn: string;
}
