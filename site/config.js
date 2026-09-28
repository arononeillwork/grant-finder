// Public site configuration. The anon key is safe to expose (row-level security protects all private data).
window.SOLICITA_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co',   // Supabase → Project Settings → API → Project URL
  supabaseKey: 'YOUR-ANON-KEY',                          // Supabase → Project Settings → API → anon public key (legacy JWT)
  operator: 'Easy Beans Coffee',
  operatorNif: '',                                       // TODO: Easy Beans SL CIF (appears on the representation template)
  operatorAddress: 'C. Pizarro 8, 29670 San Pedro de Alcántara (Málaga)',
  operatorEmail: 'easybeanscafe@gmail.com',
  commission: 0.03,   // must match RATE in supabase/functions/process-fees
  minFee: 150,        // must match MIN_FEE_CENTS/100 in process-fees
  diyPrice: 29        // shown as "free during beta (then €29)"
};
