import type { Product, ProductOption, ProductVariant } from '@vivo/domain';
import { asProductId, asStoreId, asVariantId } from '@vivo/domain';

export interface ProductBlueprint {
  readonly key: string;
  readonly storeKey: string;
  readonly title: string;
  readonly description: string;
  readonly priceMinor: number;
  readonly compareAtPriceMinor?: number;
  readonly options?: readonly ProductOption[];
  /** One entry per variant: option values plus its own stock. */
  readonly variants?: ReadonlyArray<{
    readonly values: Record<string, string>;
    readonly stock: number;
    readonly priceMinor?: number;
  }>;
  readonly stock?: number;
  readonly imageCount?: number;
  readonly status?: Product['status'];
  /** Key into the market's tax rules. Omitted means the market default. */
  readonly taxCategory?: string;
}

/**
 * Images are rendered on demand by the web app at `/media/...`, so the demo
 * dataset ships no binary assets and the repository stays small. Swapping in a
 * real StorageProvider later only changes the strings stored here.
 */
function imagesFor(key: string, title: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    url: `/media/product/${key}${index > 0 ? `-${index + 1}` : ''}`,
    alt: `${title} — foto ${index + 1}`,
  }));
}

function buildVariants(blueprint: ProductBlueprint): ProductVariant[] {
  if (!blueprint.variants || blueprint.variants.length === 0) {
    return [
      {
        id: asVariantId(`${blueprint.key}-default`),
        optionValues: {},
        sku: blueprint.key.toUpperCase().slice(0, 12),
        priceMinor: null,
        stock: blueprint.stock ?? 12,
        active: true,
      },
    ];
  }

  return blueprint.variants.map((variant, index) => ({
    id: asVariantId(`${blueprint.key}-v${index + 1}`),
    optionValues: variant.values,
    sku: `${blueprint.key.toUpperCase().slice(0, 8)}-${index + 1}`,
    priceMinor: variant.priceMinor ?? null,
    stock: variant.stock,
    active: true,
  }));
}

export function materializeProduct(blueprint: ProductBlueprint, at: Date): Product {
  return {
    id: asProductId(blueprint.key),
    storeId: asStoreId(blueprint.storeKey),
    title: blueprint.title,
    description: blueprint.description,
    basePriceMinor: blueprint.priceMinor,
    compareAtPriceMinor: blueprint.compareAtPriceMinor ?? null,
    currency: 'UYU',
    images: imagesFor(blueprint.key, blueprint.title, blueprint.imageCount ?? 3),
    options: blueprint.options ?? [],
    variants: buildVariants(blueprint),
    status: blueprint.status ?? 'active',
    taxCategory: blueprint.taxCategory ?? null,
    createdAt: at,
    updatedAt: at,
  };
}

const TALLES: ProductOption = { name: 'Talle', values: ['S', 'M', 'L', 'XL'] };
const COLORES = (values: string[]): ProductOption => ({ name: 'Color', values });

export const PRODUCT_BLUEPRINTS: readonly ProductBlueprint[] = [
  // --- Plaza Moda (moda, Montevideo) ---------------------------------------
  {
    key: 'campera-roma',
    storeKey: 'plaza-moda',
    title: 'Campera Roma',
    description:
      'Campera de gabardina con forro interior liviano, bolsillos laterales y cierre metálico. Corte recto, cae bien sobre buzo.',
    priceMinor: 249000,
    compareAtPriceMinor: 299000,
    options: [COLORES(['Negro', 'Beige']), TALLES],
    variants: [
      { values: { Color: 'Negro', Talle: 'S' }, stock: 2 },
      { values: { Color: 'Negro', Talle: 'M' }, stock: 3 },
      { values: { Color: 'Negro', Talle: 'L' }, stock: 0 },
      { values: { Color: 'Beige', Talle: 'M' }, stock: 4 },
      { values: { Color: 'Beige', Talle: 'L' }, stock: 1 },
    ],
    imageCount: 4,
  },
  {
    key: 'pantalon-cordon',
    storeKey: 'plaza-moda',
    title: 'Pantalón Cordón',
    description: 'Pantalón de gabardina elastizada, tiro medio y bolsillos profundos.',
    priceMinor: 169000,
    options: [COLORES(['Verde seco', 'Negro']), TALLES],
    variants: [
      { values: { Color: 'Verde seco', Talle: 'S' }, stock: 5 },
      { values: { Color: 'Verde seco', Talle: 'M' }, stock: 6 },
      { values: { Color: 'Negro', Talle: 'M' }, stock: 4 },
      { values: { Color: 'Negro', Talle: 'L' }, stock: 2 },
    ],
  },
  {
    key: 'buzo-parque',
    storeKey: 'plaza-moda',
    title: 'Buzo Parque',
    description: 'Buzo de algodón frisado, cuello redondo y puños acanalados.',
    priceMinor: 139000,
    compareAtPriceMinor: 159000,
    options: [COLORES(['Gris', 'Azul noche']), TALLES],
    variants: [
      { values: { Color: 'Gris', Talle: 'M' }, stock: 8 },
      { values: { Color: 'Gris', Talle: 'L' }, stock: 3 },
      { values: { Color: 'Azul noche', Talle: 'S' }, stock: 2 },
      { values: { Color: 'Azul noche', Talle: 'M' }, stock: 7 },
    ],
  },
  {
    key: 'camisa-prado',
    storeKey: 'plaza-moda',
    title: 'Camisa Prado',
    description: 'Camisa de lino y algodón, ideal para media estación.',
    priceMinor: 154000,
    options: [COLORES(['Blanco', 'Celeste']), TALLES],
    variants: [
      { values: { Color: 'Blanco', Talle: 'M' }, stock: 6 },
      { values: { Color: 'Celeste', Talle: 'M' }, stock: 3 },
      { values: { Color: 'Celeste', Talle: 'L' }, stock: 5 },
    ],
  },
  {
    key: 'bolso-cordon',
    storeKey: 'plaza-moda',
    title: 'Bolso Cordón',
    description: 'Bolso de lona encerada con correa regulable y forro impermeable.',
    priceMinor: 118000,
    stock: 14,
    imageCount: 2,
  },
  {
    key: 'vestido-solis',
    storeKey: 'plaza-moda',
    title: 'Vestido Solís',
    description: 'Vestido midi de viscosa con tiras regulables.',
    priceMinor: 189000,
    options: [TALLES],
    variants: [
      { values: { Talle: 'S' }, stock: 3 },
      { values: { Talle: 'M' }, stock: 4 },
      { values: { Talle: 'L' }, stock: 1 },
    ],
    status: 'paused',
  },

  // --- Rambla Beauty (belleza, Montevideo) ----------------------------------
  {
    key: 'serum-rambla',
    storeKey: 'rambla-beauty',
    title: 'Sérum Vitamina C 20 %',
    description: 'Sérum de vitamina C estabilizada con ácido hialurónico. Frasco de 30 ml.',
    priceMinor: 98000,
    compareAtPriceMinor: 129000,
    stock: 22,
    imageCount: 3,
  },
  {
    key: 'protector-costa',
    storeKey: 'rambla-beauty',
    title: 'Protector solar FPS 50',
    description: 'Textura ligera con acabado mate. No deja residuo blanco.',
    priceMinor: 76000,
    stock: 31,
  },
  {
    key: 'labial-mate',
    storeKey: 'rambla-beauty',
    title: 'Labial mate larga duración',
    description: 'Pigmento intenso con terminación aterciopelada.',
    priceMinor: 42000,
    options: [COLORES(['Terracota', 'Rojo clásico', 'Rosa seco'])],
    variants: [
      { values: { Color: 'Terracota' }, stock: 12 },
      { values: { Color: 'Rojo clásico' }, stock: 4 },
      { values: { Color: 'Rosa seco' }, stock: 0 },
    ],
    imageCount: 2,
  },
  {
    key: 'crema-noche',
    storeKey: 'rambla-beauty',
    title: 'Crema de noche con retinol',
    description: 'Fórmula encapsulada de baja irritación para uso nocturno.',
    priceMinor: 112000,
    stock: 9,
  },
  {
    key: 'kit-rutina',
    storeKey: 'rambla-beauty',
    title: 'Kit rutina esencial',
    description: 'Limpiador, sérum y humectante en un solo pack.',
    priceMinor: 189000,
    compareAtPriceMinor: 235000,
    stock: 6,
  },

  // --- Taller Ceibo (hogar, Canelones) --------------------------------------
  {
    key: 'mate-ceibo',
    storeKey: 'taller-ceibo',
    title: 'Mate de algarrobo torneado',
    description: 'Mate torneado a mano en algarrobo con virola de acero.',
    priceMinor: 132000,
    options: [COLORES(['Natural', 'Oscuro'])],
    variants: [
      { values: { Color: 'Natural' }, stock: 7 },
      { values: { Color: 'Oscuro' }, stock: 3 },
    ],
    imageCount: 4,
  },
  {
    key: 'tabla-quebracho',
    storeKey: 'taller-ceibo',
    title: 'Tabla de quebracho',
    description: 'Tabla de picada con canal perimetral. 45 × 25 cm.',
    priceMinor: 156000,
    stock: 5,
  },
  {
    key: 'lampara-junco',
    storeKey: 'taller-ceibo',
    title: 'Lámpara colgante de junco',
    description: 'Tejida a mano, difunde una luz cálida y pareja.',
    priceMinor: 224000,
    stock: 4,
    imageCount: 3,
  },
  {
    key: 'juego-tazas',
    storeKey: 'taller-ceibo',
    title: 'Juego de 4 tazas de cerámica',
    description: 'Esmaltadas una a una, aptas para microondas.',
    priceMinor: 148000,
    options: [COLORES(['Arena', 'Verde musgo'])],
    variants: [
      { values: { Color: 'Arena' }, stock: 6 },
      { values: { Color: 'Verde musgo' }, stock: 2 },
    ],
  },
  {
    key: 'manta-lana',
    storeKey: 'taller-ceibo',
    title: 'Manta de lana merino',
    description: 'Tejida en telar, 130 × 180 cm.',
    priceMinor: 298000,
    stock: 3,
  },

  // --- Búnker Coleccionables (Maldonado) -------------------------------------
  {
    key: 'figura-piloto',
    storeKey: 'bunker-coleccionables',
    title: 'Figura articulada Piloto Delta',
    description: 'Escala 1:12 con 28 puntos de articulación y accesorios intercambiables.',
    priceMinor: 342000,
    stock: 4,
    imageCount: 4,
  },
  {
    key: 'album-figuritas',
    storeKey: 'bunker-coleccionables',
    title: 'Álbum tapa dura + 20 sobres',
    description: 'Edición limitada con láminas metalizadas.',
    priceMinor: 89000,
    stock: 15,
  },
  {
    key: 'carta-holo',
    storeKey: 'bunker-coleccionables',
    title: 'Carta holográfica Serie Austral',
    description: 'Estado NM, guardada en funda rígida desde su apertura.',
    priceMinor: 470000,
    stock: 1,
    imageCount: 2,
  },
  {
    key: 'maqueta-tranvia',
    storeKey: 'bunker-coleccionables',
    title: 'Maqueta tranvía 1910',
    description: 'Réplica en metal fundido con detalles pintados a mano.',
    priceMinor: 268000,
    stock: 2,
  },
  {
    key: 'vinilo-edicion',
    storeKey: 'bunker-coleccionables',
    title: 'Vinilo edición aniversario',
    description: 'Prensado de 180 g con encarte de 12 páginas.',
    priceMinor: 132000,
    stock: 8,
  },

  // --- Cable Sur (tecnología, Salto) -----------------------------------------
  {
    key: 'auriculares-anc',
    storeKey: 'cable-sur',
    title: 'Auriculares con cancelación de ruido',
    description: 'Bluetooth 5.3, 32 h de autonomía y estuche de carga.',
    priceMinor: 389000,
    compareAtPriceMinor: 459000,
    options: [COLORES(['Negro', 'Marfil'])],
    variants: [
      { values: { Color: 'Negro' }, stock: 6 },
      { values: { Color: 'Marfil' }, stock: 2 },
    ],
    imageCount: 3,
  },
  {
    key: 'cargador-gan',
    storeKey: 'cable-sur',
    title: 'Cargador GaN 65 W',
    description: 'Tres puertos, carga una notebook y dos teléfonos a la vez.',
    priceMinor: 124000,
    stock: 18,
  },
  {
    key: 'soporte-celular',
    storeKey: 'cable-sur',
    title: 'Soporte de aluminio para celular',
    description: 'Ángulo regulable, pensado para transmitir en vertical.',
    priceMinor: 68000,
    stock: 25,
    imageCount: 2,
  },
  {
    key: 'aro-luz',
    storeKey: 'cable-sur',
    title: 'Aro de luz 26 cm con trípode',
    description: 'Tres temperaturas de color y diez niveles de intensidad.',
    priceMinor: 179000,
    stock: 11,
  },
  {
    key: 'microfono-solapa',
    storeKey: 'cable-sur',
    title: 'Micrófono inalámbrico de solapa',
    description: 'Dos transmisores y receptor USB-C. Alcance de 20 m.',
    priceMinor: 246000,
    stock: 7,
  },
];
