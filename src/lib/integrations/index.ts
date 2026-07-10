import { callEdgeFunction, getEdgeFunction } from '../edge';
import {
  Divergence,
  IntegrationStatus,
  ProductMonitor,
  OrderMonitor,
  UpdateIntegrationsResult,
  IntegrationSource,
} from '../../types';

const SOURCE_LABELS: Record<IntegrationSource, string> = {
  bling: 'Bling',
  mercadolivre: 'Mercado Livre',
  shopee: 'Shopee',
  system: 'Sistema',
};

// ─── Conciliação ─────────────────────────────────────────────────────────────
// Todo o cálculo de divergências agora acontece na Edge Function `reconcile`,
// que busca dados reais no Bling/ML/Shopee (nunca mock) e usa o ERP como
// fonte da verdade, conforme o princípio 01 do documento estratégico.
export async function computeDivergences(): Promise<Divergence[]> {
  const res = await callEdgeFunction<{ ok: boolean; data?: Divergence[]; notConfigured?: string[]; error?: string }>(
    'reconcile',
    { action: 'refresh_divergences' }
  );
  if (!res.ok) {
    throw new Error(res.error ?? 'Falha ao calcular divergências');
  }
  return res.data ?? [];
}

export async function fixDivergence(divergence: Divergence): Promise<{ ok: boolean; error?: string }> {
  return callEdgeFunction('reconcile', { action: 'fix_one', params: { divergenceId: divergence.id } });
}


// ─── Status das integrações (Admin / Dashboard / Integrar) ──────────────────
interface StatusRow {
  source: IntegrationSource;
  configured: boolean;
  connected: boolean;
  tokenValid: boolean;
  lastSync: string | null;
  responseMs: number | null;
  errorCount: number;
}

export async function getIntegrationStatuses(): Promise<IntegrationStatus[]> {
  const res = await getEdgeFunction<{ ok: boolean; data: StatusRow[] }>('integrations-status');
  if (!res.ok) return [];
  return res.data.map((row) => ({
    source: row.source,
    label: SOURCE_LABELS[row.source],
    connected: row.tokenValid,
    lastSync: row.lastSync,
    responseMs: row.responseMs,
    errorCount: row.errorCount,
    tokenConfigured: row.configured,
  }));
}

export async function updateAllIntegrations(): Promise<UpdateIntegrationsResult> {
  return callEdgeFunction<UpdateIntegrationsResult>('reconcile', { action: 'update_integrations' });
}

// ─── Monitor (produtos e pedidos) ────────────────────────────────────────────
interface BlingProductDTO {
  id: string; sku: string; name: string; stock: number; price: number;
  hasPhoto: boolean; hasDescription: boolean;
  photoCount: number; descriptionText: string | null;
  categoria: string | null; marca: string | null; gtin: string | null;
  peso: number | null; situacao: string | null; ncm: string | null;
  precoCusto: number | null; tipo: string | null; unidade: string | null;
}
interface MLListingDTO {
  itemId: string; sku: string | null; title: string; stock: number; status: string;
  price: number; soldQuantity: number; health: number | null;
  permalink: string | null; thumbnail: string | null; pictureCount: number;
  videoId: string | null; listingType: string | null; condition: string | null;
  categoryId: string | null; freeShipping: boolean | null; localPickUp: boolean | null;
  warranty: string | null; acceptsMercadoPago: boolean | null;
  catalogListing: boolean | null;
  attributes: Array<{ id: string; name: string; valueName: string | null }>;
  tags: string[]; dateCreated: string | null; lastUpdated: string | null;
}
interface ShopeeListingDTO { itemId: number; sku: string | null; name: string; stock: number; status: string }

export function mapMlStatus(status: string): ProductMonitor['mlStatus'] {
  if (status === 'active' || status === 'paused' || status === 'closed') return status;
  return 'not_listed';
}
export function mapShopeeStatus(status: string): ProductMonitor['shopeeStatus'] {
  if (status === 'NORMAL') return 'active';
  if (status === 'UNLIST') return 'paused';
  if (status === 'BANNED' || status === 'DELETED') return 'closed';
  return 'not_listed';
}

export async function getProductMonitorData(): Promise<ProductMonitor[]> {
  const [blingRes, mlRes, shopeeRes] = await Promise.all([
    callEdgeFunction<{ ok: boolean; data?: BlingProductDTO[]; error?: string }>('bling-api', { action: 'get_products' }),
    callEdgeFunction<{ ok: boolean; data?: MLListingDTO[]; error?: string }>('ml-api', { action: 'get_listings' }),
    callEdgeFunction<{ ok: boolean; data?: ShopeeListingDTO[]; error?: string }>('shopee-api', { action: 'get_listings' }),
  ]);

  if (!blingRes.ok) {
    // O Bling é o ERP / fonte oficial: sem ele não existe "monitor de produtos" confiável.
    throw new Error(blingRes.error ?? 'Integração não configurada.');
  }

  const products = blingRes.data ?? [];
  const mlMap = new Map((mlRes.ok ? mlRes.data ?? [] : []).map((l) => [l.sku, l]));
  const shMap = new Map((shopeeRes.ok ? shopeeRes.data ?? [] : []).map((l) => [l.sku, l]));

  return products.map((p) => {
    const ml = mlMap.get(p.sku);
    const sh = shMap.get(p.sku);
    return {
      sku: p.sku,
      name: p.name,
      erpStock: p.stock,
      erpPrice: p.price,
      erpPrecoCusto: p.precoCusto,
      erpCategoria: p.categoria,
      erpMarca: p.marca,
      erpGtin: p.gtin,
      erpPeso: p.peso,
      erpSituacao: p.situacao,
      erpNcm: p.ncm,
      erpTipo: p.tipo,
      erpUnidade: p.unidade,
      erpPhotoCount: p.photoCount,
      erpDescriptionText: p.descriptionText,
      mlStock: ml?.stock ?? null,
      shopeeStock: sh?.stock ?? null,
      hasPhoto: p.hasPhoto,
      hasDescription: p.hasDescription,
      hasVideo: ml?.videoId != null,
      mlStatus: ml ? mapMlStatus(ml.status) : 'not_listed',
      shopeeStatus: sh ? mapShopeeStatus(sh.status) : 'not_listed',
      mlItemId: ml?.itemId ?? null,
      mlTitle: ml?.title ?? null,
      mlPrice: ml?.price ?? null,
      mlSoldQuantity: ml?.soldQuantity ?? null,
      mlHealth: ml?.health ?? null,
      mlPermalink: ml?.permalink ?? null,
      mlThumbnail: ml?.thumbnail ?? null,
      mlPictureCount: ml?.pictureCount ?? null,
      mlVideoId: ml?.videoId ?? null,
      mlListingType: ml?.listingType ?? null,
      mlCondition: ml?.condition ?? null,
      mlCategoryId: ml?.categoryId ?? null,
      mlFreeShipping: ml?.freeShipping ?? null,
      mlLocalPickUp: ml?.localPickUp ?? null,
      mlWarranty: ml?.warranty ?? null,
      mlAcceptsMercadoPago: ml?.acceptsMercadoPago ?? null,
      mlCatalogListing: ml?.catalogListing ?? null,
      mlAttributes: ml?.attributes ?? [],
      mlTags: ml?.tags ?? [],
      mlDateCreated: ml?.dateCreated ?? null,
      mlLastUpdated: ml?.lastUpdated ?? null,
    };
  });
}

interface BlingOrderDTO {
  id?: string | number;
  numero?: string | number;
  contato?: { nome?: string };
  total?: number;
  data?: string;
  situacao?: { id?: number; valor?: number };
}

export async function getOrderMonitorData(): Promise<OrderMonitor[]> {
  const res = await callEdgeFunction<{ ok: boolean; data?: BlingOrderDTO[]; error?: string }>('bling-api', { action: 'get_orders' });
  if (!res.ok) throw new Error(res.error ?? 'Integração não configurada.');

  // ATENÇÃO: o Bling representa a situação do pedido por um código numérico
  // (situacao.id) próprio de cada conta/fluxo cadastrado. Não temos acesso a
  // uma conta real para confirmar quais códigos correspondem a "Novo",
  // "Pago", "Aguardando NF", etc. Em vez de inventar esse mapeamento,
  // devolvemos o pedido com status "new" e os dados brutos preservados —
  // ajuste esta função assim que os códigos da conta real forem
  // confirmados (ver AUDITORIA.md).
  return (res.data ?? []).map((o) => ({
    id: String(o.numero ?? o.id ?? ''),
    marketplace: 'bling' as const,
    status: 'new' as const,
    buyerName: o.contato?.nome ?? '—',
    total: Number(o.total ?? 0),
    createdAt: o.data ?? new Date().toISOString(),
    updatedAt: o.data ?? new Date().toISOString(),
  }));
}
