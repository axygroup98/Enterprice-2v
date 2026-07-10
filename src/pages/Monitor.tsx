import { useEffect, useState } from 'react';
import {
  Package, ShoppingBag, Plug, Search, RefreshCw,
  CheckCircle, XCircle, MinusCircle, AlertCircle,
  ExternalLink, ChevronRight, X, Tag, ShieldCheck, Box,
} from 'lucide-react';
import { getProductMonitorData, getOrderMonitorData, getIntegrationStatuses } from '../lib/integrations';
import { ProductMonitor, OrderMonitor, IntegrationStatus } from '../types';

type Tab = 'produtos' | 'pedidos' | 'apis';

const ORDER_STATUS_LABELS: Record<string, string> = {
  new: 'Novo',
  paid: 'Pago',
  awaiting_nf: 'Aguardando NF',
  separating: 'Em Separação',
  shipped: 'Enviado',
  delivered: 'Entregado',
  stopped: 'Parado',
};

const ORDER_STATUS_COLORS: Record<string, string> = {
  new:         'bg-blue-50 text-blue-700 border-blue-200',
  paid:        'bg-green-50 text-green-700 border-green-200',
  awaiting_nf: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  separating:  'bg-purple-50 text-purple-700 border-purple-200',
  shipped:     'bg-indigo-50 text-indigo-700 border-indigo-200',
  delivered:   'bg-gray-50 text-gray-700 border-gray-200',
  stopped:     'bg-red-50 text-red-700 border-red-200',
};

// ─── Health Score helpers ─────────────────────────────────────────────
function healthColor(h: number | null): { dot: string; text: string; bg: string; label: string } {
  if (h === null) return { dot: 'bg-gray-300', text: 'text-gray-400', bg: 'bg-gray-50', label: 'N/D' };
  if (h >= 85) return { dot: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-50', label: 'Excelente' };
  if (h >= 70) return { dot: 'bg-yellow-500', text: 'text-yellow-700', bg: 'bg-yellow-50', label: 'Boa' };
  if (h >= 50) return { dot: 'bg-orange-500', text: 'text-orange-700', bg: 'bg-orange-50', label: 'Regular' };
  return { dot: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50', label: 'Crítica' };
}

// Attach helper method to ProductMonitor via module-level function
// (keeps the type clean — this is a pure UI concern)
function mlGtin(p: ProductMonitor): string | null {
  const gtin = p.mlAttributes.find((a) => a.id === 'GTIN' || a.id === 'EAN');
  return gtin?.valueName ?? null;
}

// ─── Pendências helper ────────────────────────────────────────────────
function computePendencias(p: ProductMonitor): string[] {
  const list: string[] = [];
  if (p.mlItemId === null) return list;
  if (p.mlVideoId === null) list.push('Sem vídeo');
  if (p.mlPictureCount !== null && p.mlPictureCount < 3) list.push('Poucas fotos');
  if (!p.hasDescription) list.push('Descrição incompleta');
  if (p.mlAttributes.length < 5) list.push('Poucos atributos');
  if (p.mlCategoryId === null) list.push('Categoria incompleta');
  if (p.mlTitle !== null && p.mlTitle.length < 30) list.push('Título fraco');
  if (mlGtin(p) === null) list.push('Sem GTIN');
  if (p.mlWarranty === null) list.push('Sem garantia');
  return list;
}

// ─── Photo badge ──────────────────────────────────────────────────────
function PhotoCell({ count }: { count: number | null }) {
  if (count === null) return <span className="text-xs text-gray-400">—</span>;
  if (count === 0) return <span className="text-xs text-red-500 font-medium flex items-center gap-1 justify-center"><XCircle className="h-3.5 w-3.5" /> Nenhuma</span>;
  if (count < 3) return <span className="text-xs text-amber-600 font-medium flex items-center gap-1 justify-center"><AlertCircle className="h-3.5 w-3.5" /> {count} foto(s)</span>;
  return <span className="text-xs text-green-600 font-medium flex items-center gap-1 justify-center"><CheckCircle className="h-3.5 w-3.5" /> {count} fotos</span>;
}

// ─── Description badge ────────────────────────────────────────────────
function DescCell({ has, text }: { has: boolean; text: string | null }) {
  if (!has || !text) return <span className="text-xs text-red-500 font-medium">Ausente</span>;
  if (text.length < 100) return <span className="text-xs text-amber-600 font-medium">Curta</span>;
  return <span className="text-xs text-green-600 font-medium">Completa</span>;
}

// ─── Video badge ──────────────────────────────────────────────────────
function VideoCell({ has }: { has: boolean }) {
  return has
    ? <span className="text-xs text-green-600 font-medium">Possui</span>
    : <span className="text-xs text-red-400 font-medium">Não possui</span>;
}

// ─── Stock badge (existing logic, unchanged) ─────────────────────────
function StockBadge({ erp, mp }: { erp: number; mp: number | null }) {
  if (mp === null) return <span className="text-xs text-gray-400">Não listado</span>;
  if (erp === mp) return <span className="text-xs text-green-600 font-medium">OK ({erp})</span>;
  const color = mp > erp ? 'text-red-600' : 'text-orange-600';
  return (
    <div className="flex flex-col">
      <span className={`text-xs font-medium ${color}`}>MP: {mp}</span>
      <span className="text-xs text-gray-400">ERP: {erp}</span>
    </div>
  );
}

// ─── ML Status badge ──────────────────────────────────────────────────
function MLStatusBadge({ status }: { status: ProductMonitor['mlStatus'] }) {
  if (status === null || status === 'not_listed')
    return <span className="text-xs text-gray-400">—</span>;
  const map = {
    active: { label: 'Ativo', cls: 'text-green-700 bg-green-50' },
    paused: { label: 'Pausado', cls: 'text-yellow-700 bg-yellow-50' },
    closed: { label: 'Encerrado', cls: 'text-gray-700 bg-gray-100' },
  };
  const c = map[status];
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.cls}`}>{c.label}</span>;
}

// ─── Pendências badge ─────────────────────────────────────────────────
function PendenciasCell({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-xs text-green-600 font-medium flex items-center gap-1 justify-center"><CheckCircle className="h-3.5 w-3.5" /> OK</span>;
  return (
    <div className="flex flex-wrap gap-1 justify-center max-w-[180px]">
      {items.slice(0, 3).map((item, i) => (
        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">{item}</span>
      ))}
      {items.length > 3 && <span className="text-[10px] text-amber-600 font-medium">+{items.length - 3}</span>}
    </div>
  );
}

// ─── Detail Drawer ────────────────────────────────────────────────────
function DetailDrawer({ product, onClose }: { product: ProductMonitor; onClose: () => void }) {
  const gtin = mlGtin(product);
  const pendencias = computePendencias(product);
  const hc = healthColor(product.mlHealth);
  const listingTypeLabel: Record<string, string> = {
    gold_pro: 'Gold Pro',
    gold_special: 'Gold Special',
    gold: 'Gold',
    silver: 'Silver',
    bronze: 'Bronze',
    free: 'Grátis',
  };
  const conditionLabel: Record<string, string> = {
    new: 'Novo',
    used: 'Usado',
    not_specified: 'Não especificado',
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 truncate pr-4">Detalhes do Anúncio</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-6">
          {/* Product name + SKU */}
          <div>
            <p className="text-base font-semibold text-gray-900 leading-snug">{product.name}</p>
            <p className="text-xs text-gray-400 font-mono mt-1">SKU: {product.sku}</p>
          </div>

          {/* Health Score */}
          {product.mlItemId && (
            <div className={`rounded-xl p-4 ${hc.bg}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4" /> Saúde do Anúncio
                </span>
                {product.mlPermalink && (
                  <a href={product.mlPermalink} target="_blank" rel="noopener noreferrer"
                     className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                    Ver anúncio <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className={`text-3xl font-bold ${hc.text}`}>
                  {product.mlHealth !== null ? `${product.mlHealth}%` : 'N/D'}
                </div>
                <div>
                  <span className={`text-sm font-medium ${hc.text}`}>{hc.label}</span>
                  {product.mlSoldQuantity !== null && (
                    <p className="text-xs text-gray-500 mt-0.5">{product.mlSoldQuantity} vendidos</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Pendências */}
          {product.mlItemId && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Pendências</h3>
              {pendencias.length === 0 ? (
                <div className="flex items-center gap-1.5 text-sm text-green-600">
                  <CheckCircle className="h-4 w-4" /> Nenhuma pendência detectada
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {pendencias.map((p, i) => (
                    <span key={i} className="text-xs px-2 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">{p}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ERP Section */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Box className="h-4 w-4" /> ERP (Bling)
            </h3>
            <div className="space-y-2">
              <DetailRow label="Estoque" value={String(product.erpStock)} />
              <DetailRow label="Preço" value={`R$ ${product.erpPrice.toFixed(2)}`} />
              {product.erpPrecoCusto !== null && <DetailRow label="Custo" value={`R$ ${product.erpPrecoCusto.toFixed(2)}`} />}
              {product.erpCategoria && <DetailRow label="Categoria" value={product.erpCategoria} />}
              {product.erpMarca && <DetailRow label="Marca" value={product.erpMarca} />}
              {product.erpGtin && <DetailRow label="GTIN" value={product.erpGtin} />}
              {product.erpPeso !== null && <DetailRow label="Peso (kg)" value={String(product.erpPeso)} />}
              {product.erpSituacao && <DetailRow label="Situação" value={product.erpSituacao} />}
              {product.erpNcm && <DetailRow label="NCM" value={product.erpNcm} />}
              {product.erpTipo && <DetailRow label="Tipo" value={product.erpTipo} />}
              {product.erpUnidade && <DetailRow label="Unidade" value={product.erpUnidade} />}
              <DetailRow label="Fotos" value={product.erpPhotoCount > 0 ? `${product.erpPhotoCount} foto(s)` : 'Nenhuma'} />
              <DetailRow label="Descrição" value={product.erpDescriptionText ? (product.erpDescriptionText.length >= 100 ? 'Completa' : 'Curta') : 'Ausente'} />
            </div>
          </div>

          {/* Marketplace Section */}
          {product.mlItemId ? (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <ShoppingBag className="h-4 w-4" /> Marketplace (Mercado Livre)
              </h3>
              <div className="space-y-2">
                <DetailRow label="Item ID" value={product.mlItemId} mono />
                {product.mlTitle && <DetailRow label="Título ML" value={product.mlTitle} />}
                <DetailRow label="Status" value={product.mlStatus === 'active' ? 'Ativo' : product.mlStatus === 'paused' ? 'Pausado' : product.mlStatus === 'closed' ? 'Encerrado' : '—'} />
                <DetailRow label="Estoque ML" value={String(product.mlStock ?? '—')} />
                {product.mlPrice !== null && <DetailRow label="Preço ML" value={`R$ ${product.mlPrice.toFixed(2)}`} />}
                {product.mlSoldQuantity !== null && <DetailRow label="Qtd. vendida" value={String(product.mlSoldQuantity)} />}
                {product.mlListingType && <DetailRow label="Tipo anúncio" value={listingTypeLabel[product.mlListingType] ?? product.mlListingType} />}
                {product.mlCondition && <DetailRow label="Condição" value={conditionLabel[product.mlCondition] ?? product.mlCondition} />}
                {product.mlCategoryId && <DetailRow label="Categoria ML" value={product.mlCategoryId} />}
                {product.mlPictureCount !== null && <DetailRow label="Fotos ML" value={String(product.mlPictureCount)} />}
                <DetailRow label="Vídeo" value={product.mlVideoId ? 'Possui' : 'Não possui'} />
                {product.mlFreeShipping !== null && <DetailRow label="Frete grátis" value={product.mlFreeShipping ? 'Sim' : 'Não'} />}
                {product.mlLocalPickUp !== null && <DetailRow label="Retirada local" value={product.mlLocalPickUp ? 'Sim' : 'Não'} />}
                {product.mlWarranty && <DetailRow label="Garantia" value={product.mlWarranty} />}
                {product.mlAcceptsMercadoPago !== null && <DetailRow label="Mercado Pago" value={product.mlAcceptsMercadoPago ? 'Sim' : 'Não'} />}
                {product.mlCatalogListing !== null && <DetailRow label="Catálogo" value={product.mlCatalogListing ? 'Sim' : 'Não'} />}
                {gtin && <DetailRow label="GTIN (ML)" value={gtin} />}
                {product.mlDateCreated && <DetailRow label="Criado em" value={new Date(product.mlDateCreated).toLocaleDateString('pt-BR')} />}
                {product.mlLastUpdated && <DetailRow label="Atualizado" value={new Date(product.mlLastUpdated).toLocaleDateString('pt-BR')} />}
                {product.mlTags.length > 0 && <DetailRow label="Tags" value={product.mlTags.join(', ')} />}
              </div>

              {/* Attributes */}
              {product.mlAttributes.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1.5"><Tag className="h-3.5 w-3.5" /> Atributos</p>
                  <div className="flex flex-wrap gap-1.5">
                    {product.mlAttributes.map((a, i) => (
                      <span key={i} className="text-xs px-2 py-1 rounded-lg bg-gray-50 text-gray-600 border border-gray-200">
                        {a.name}: {a.valueName ?? '—'}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-gray-400 italic">Produto não listado no Mercado Livre</div>
          )}
        </div>
      </div>
    </>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <span className={`text-xs font-medium text-gray-900 text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────
export function Monitor() {
  const [tab, setTab] = useState<Tab>('produtos');
  const [products, setProducts] = useState<ProductMonitor[]>([]);
  const [orders, setOrders] = useState<OrderMonitor[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [orderFilter, setOrderFilter] = useState('all');
  const [selectedProduct, setSelectedProduct] = useState<ProductMonitor | null>(null);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [prods, ords, ints] = await Promise.all([
        getProductMonitorData(),
        getOrderMonitorData(),
        getIntegrationStatuses(),
      ]);
      setProducts(prods);
      setOrders(ords);
      setIntegrations(ints);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Integração não configurada.');
      setProducts([]);
      setOrders([]);
    }
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase())
  );

  const filteredOrders =
    orderFilter === 'all' ? orders : orders.filter((o) => o.status === orderFilter);

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'produtos', label: 'Produtos', icon: Package },
    { id: 'pedidos', label: 'Pedidos', icon: ShoppingBag },
    { id: 'apis', label: 'APIs', icon: Plug },
  ];

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>
        <button
          onClick={loadAll}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border border-gray-200 bg-white rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <span>⚠ {error}</span>
        </div>
      )}

      {/* Produtos Tab */}
      {tab === 'produtos' && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="p-4 border-b border-gray-100 flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar produto ou SKU..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <span className="text-xs text-gray-400">{filteredProducts.length} produto(s)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Produto / SKU</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3" title="Estoque ERP">Est. ERP</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3" title="Preço ERP">Preço ERP</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3" title="Estoque Mercado Livre">Est. ML</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3" title="Preço Mercado Livre">Preço ML</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Status ML</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3" title="Saúde do Anúncio">Saúde</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Fotos</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Descrição</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Vídeo</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Pendências</th>
                  <th className="px-2 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-4 py-3"><div className="h-4 bg-gray-200 rounded w-48" /></td>
                      {Array.from({ length: 11 }).map((__, j) => (
                        <td key={j} className="px-3 py-3 text-center"><div className="h-4 bg-gray-200 rounded w-8 mx-auto" /></td>
                      ))}
                    </tr>
                  ))
                ) : filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-4 py-12 text-center text-sm text-gray-400">
                      Nenhum produto encontrado
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map((p) => {
                    const hc = healthColor(p.mlHealth);
                    const pendencias = computePendencias(p);
                    return (
                      <tr
                        key={p.sku}
                        className="hover:bg-gray-50 transition-colors cursor-pointer"
                        onClick={() => setSelectedProduct(p)}
                      >
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-gray-900 leading-snug">{p.name}</p>
                          <p className="text-xs text-gray-400 font-mono mt-0.5">{p.sku}</p>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className="text-sm font-semibold text-gray-900">{p.erpStock}</span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className="text-xs font-medium text-gray-700">R$ {p.erpPrice.toFixed(2)}</span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <StockBadge erp={p.erpStock} mp={p.mlStock} />
                        </td>
                        <td className="px-3 py-3 text-center">
                          {p.mlPrice !== null ? (
                            <span className="text-xs font-medium text-gray-700">R$ {p.mlPrice.toFixed(2)}</span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center"><MLStatusBadge status={p.mlStatus} /></td>
                        <td className="px-3 py-3 text-center">
                          {p.mlHealth !== null ? (
                            <div className="flex items-center gap-1.5 justify-center">
                              <span className={`h-2 w-2 rounded-full ${hc.dot}`} />
                              <span className={`text-xs font-semibold ${hc.text}`}>{p.mlHealth}%</span>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center"><PhotoCell count={p.mlPictureCount ?? (p.erpPhotoCount > 0 ? p.erpPhotoCount : null)} /></td>
                        <td className="px-3 py-3 text-center"><DescCell has={p.hasDescription} text={p.erpDescriptionText} /></td>
                        <td className="px-3 py-3 text-center"><VideoCell has={p.hasVideo} /></td>
                        <td className="px-3 py-3 text-center"><PendenciasCell items={pendencias} /></td>
                        <td className="px-2 py-3 text-center">
                          <ChevronRight className="h-4 w-4 text-gray-300" />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pedidos Tab */}
      {tab === 'pedidos' && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="p-4 border-b border-gray-100 flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-gray-700">Filtrar:</span>
            {['all', 'new', 'paid', 'awaiting_nf', 'separating', 'shipped', 'delivered', 'stopped'].map((f) => (
              <button
                key={f}
                onClick={() => setOrderFilter(f)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  orderFilter === f
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}
              >
                {f === 'all' ? 'Todos' : ORDER_STATUS_LABELS[f]}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Pedido</th>
                  <th className="text-left text-xs font-semibold text-gray-500 px-3 py-3">Canal</th>
                  <th className="text-left text-xs font-semibold text-gray-500 px-3 py-3">Comprador</th>
                  <th className="text-right text-xs font-semibold text-gray-500 px-3 py-3">Total</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Status</th>
                  <th className="text-right text-xs font-semibold text-gray-500 px-4 py-3">Criado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-400">
                      Nenhum pedido encontrado
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((o) => (
                    <tr key={o.id} className={`hover:bg-gray-50 transition-colors ${o.status === 'stopped' ? 'bg-red-50/30' : ''}`}>
                      <td className="px-4 py-3">
                        <p className="text-sm font-mono font-medium text-gray-900">{o.id}</p>
                        {o.status === 'stopped' && o.daysStopped != null && (
                          <p className="text-xs text-red-600 flex items-center gap-1 mt-0.5">
                            <AlertCircle className="h-3 w-3" /> Parado há {o.daysStopped} dia(s)
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                          o.marketplace === 'mercadolivre'
                            ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
                            : o.marketplace === 'shopee'
                            ? 'bg-orange-50 text-orange-700 border-orange-200'
                            : 'bg-blue-50 text-blue-700 border-blue-200'
                        }`}>
                          {o.marketplace === 'mercadolivre' ? 'Mercado Livre' : o.marketplace === 'shopee' ? 'Shopee' : 'Bling'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-700">{o.buyerName}</td>
                      <td className="px-3 py-3 text-right text-sm font-semibold text-gray-900">
                        {o.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${ORDER_STATUS_COLORS[o.status]}`}>
                          {ORDER_STATUS_LABELS[o.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-gray-400">
                        {new Date(o.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* APIs Tab */}
      {tab === 'apis' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {loading
            ? [1, 2, 3].map((i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
                  <div className="h-5 w-28 bg-gray-200 rounded mb-4" />
                  <div className="space-y-2">
                    {[1, 2, 3, 4].map((j) => <div key={j} className="h-4 bg-gray-100 rounded" />)}
                  </div>
                </div>
              ))
            : integrations.map((int) => (
                <div key={int.source} className="bg-white rounded-xl border border-gray-200 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-gray-900">{int.label}</h3>
                    <span
                      className={`h-3 w-3 rounded-full ${
                        !int.tokenConfigured ? 'bg-gray-300' : int.connected ? 'bg-green-500' : 'bg-red-500'
                      }`}
                    />
                  </div>
                  <div className="space-y-3">
                    <Row label="Token" value={int.tokenConfigured ? 'Configurado' : 'Não configurado'} ok={int.tokenConfigured} />
                    <Row label="Status" value={int.connected ? 'Conectado' : int.tokenConfigured ? 'Erro' : 'Sem token'} ok={int.connected} />
                    <Row
                      label="Última sync"
                      value={int.lastSync ? new Date(int.lastSync).toLocaleString('pt-BR') : 'Nunca'}
                      ok={Boolean(int.lastSync)}
                    />
                    <Row
                      label="Tempo médio"
                      value={int.responseMs != null ? `${int.responseMs}ms` : '—'}
                      ok={int.responseMs != null && int.responseMs < 1000}
                    />
                    <Row
                      label="Erros recentes"
                      value={String(int.errorCount)}
                      ok={int.errorCount === 0}
                    />
                  </div>
                </div>
              ))}
        </div>
      )}

      {/* Detail Drawer */}
      {selectedProduct && (
        <DetailDrawer product={selectedProduct} onClose={() => setSelectedProduct(null)} />
      )}
    </div>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="flex items-center gap-1.5">
        {ok ? <CheckCircle className="h-3.5 w-3.5 text-green-500" /> : <MinusCircle className="h-3.5 w-3.5 text-gray-300" />}
        <span className="text-xs font-medium text-gray-700">{value}</span>
      </div>
    </div>
  );
}
