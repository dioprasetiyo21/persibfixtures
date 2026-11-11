const TEAM_LOGOS: Record<string, string> = {
  'Persib Bandung': '/logos/persib.png',
  'Arema FC': '/logos/sm/aremaFc.png',
  'Bali United': '/logos/sm/baliUtd.png',
  'Bhayangkara Presisi': '/logos/sm/Bhayangkara.png',
  'Borneo FC Samarinda': '/logos/sm/borneo.png',
  'Dewa United': '/logos/sm/dewa.png',
  'Garudayaksa FC': '/logos/sm/garufayaksa.png',
  'Isen Mulang Kalteng FC': '/logos/sm/isenmulang.png',
  'Java United': '/logos/sm/javaUtd.png',
  'Madura United': '/logos/sm/maduraUtd.png',
  'Persebaya Surabaya': '/logos/sm/Persebaya.png',
  'Persija Jakarta': '/logos/sm/persija.png',
  'Persijap Jepara': '/logos/sm/persijap.png',
  'Persik Kediri': '/logos/sm/persik.png',
  'Persita Tangerang': '/logos/sm/persita.png',
  'PSIM Yogyakarta': '/logos/sm/psim.png',
  'PSM Makassar': '/logos/sm/psm.png',
  'PSS Sleman': '/logos/sm/pss.png',
  'Port FC': '/logos/sm/acc-port.png',
  'Shan United': '/logos/sm/acc-shan.png',
  'Lion City Sailors': '/logos/sm/acc-lcs.png',
  "Johor Darul Ta'zim": '/logos/sm/acc-jdt.png',
  'PKR Svay Rieng': '/logos/sm/acc-svay.png',
  'Công An Hà Nội': '/logos/sm/acc-cahn.png',
  'FC Seoul': '/logos/sm/acl2-seoul.png',
  'The Cong-Viettel': '/logos/sm/acl2-thecong.png',
  'Melbourne Victory': '/logos/sm/acl2-melbourn.png',
}

export function teamLogo(name: string): string | null {
  return TEAM_LOGOS[name] ?? null
}
