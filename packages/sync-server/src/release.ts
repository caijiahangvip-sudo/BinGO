import { config } from './config.js';

/**
 * BinGO 版本命名约定（docs/release-naming.md）：
 * - 整大版本（5.0、6.0……）用大版本名，如 5.0 = Rome；
 * - 小版本（5.1、5.2……）依次取城市名，如 5.1 = Ostia。
 * 环境变量 BINGO_RELEASE_CODENAME 可覆盖自动推导的代号。
 */
export interface ReleaseProvince {
  /** 行省名 */
  province: string;
  /** 省会，即大版本代号 */
  capital: string;
  /** 本行省城市，依次作为 1、2、3… 小版本代号 */
  cities: string[];
}

export const RELEASE_PROVINCES: Readonly<Record<number, ReleaseProvince>> = Object.freeze({
  5: {
    province: 'Italia',
    capital: 'Rome',
    cities: ['Ostia', 'Pompeii', 'Neapolis', 'Capua', 'Florentia', 'Patavium', 'Ravenna', 'Mediolanum'],
  },
  6: {
    province: 'Britannia',
    capital: 'Londinium',
    cities: ['Eboracum', 'Camulodunum', 'Aquae Sulis', 'Verulamium', 'Corinium', 'Lindum'],
  },
  7: {
    province: 'Gallia Lugdunensis',
    capital: 'Lugdunum',
    cities: ['Lutetia', 'Avaricum', 'Rotomagus', 'Agedincum', 'Augustodunum', 'Cenabum'],
  },
  8: {
    province: 'Hispania Tarraconensis',
    capital: 'Tarraco',
    cities: ['Barcino', 'Valentia', 'Caesaraugusta', 'Corduba', 'Hispalis', 'Toletum'],
  },
  9: {
    province: 'Africa Proconsularis',
    capital: 'Carthago',
    cities: ['Utica', 'Hadrumetum', 'Leptis Magna', 'Thysdrus', 'Cirta', 'Bulla Regia'],
  },
  10: {
    province: 'Aegyptus',
    capital: 'Alexandria',
    cities: ['Memphis', 'Thebae', 'Oxyrhynchus', 'Hermopolis', 'Naucratis'],
  },
  11: {
    province: 'Syria',
    capital: 'Antiochia',
    cities: ['Damascus', 'Palmyra', 'Berytus', 'Hierapolis', 'Apamea'],
  },
  12: {
    province: 'Thracia',
    capital: 'Constantinopolis',
    cities: ['Philippopolis', 'Adrianopolis', 'Serdica', 'Marcianopolis'],
  },
});

/** 兼容旧引用：所有已用代号（先省会后城市）。 */
export const RELEASE_CITIES = Object.freeze(
  Object.values(RELEASE_PROVINCES).flatMap((line) => [line.capital, ...line.cities]),
);

export function releaseMetadata() {
  const version = config.BINGO_RELEASE_VERSION;
  const [major = 0, minor = 0] = version.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const line = RELEASE_PROVINCES[major];
  const derived = minor === 0 ? line?.capital : line?.cities[minor - 1];
  const codename = config.BINGO_RELEASE_CODENAME || derived || 'Rome';
  return {
    version,
    codename,
    majorCodename: line?.capital ?? null,
    province: line?.province ?? null,
    modelProfile: config.BINGO_MODEL_PROFILE,
    releaseSequence: RELEASE_CITIES.indexOf(codename) + 1 || null,
  };
}
