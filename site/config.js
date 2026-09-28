// Public site configuration. The anon key is safe to expose (row-level security protects all private data).
window.SOLICITA_CONFIG = {
  supabaseUrl: 'https://hjmfbknjeewgckllgbnp.supabase.co',  // Supabase project "Grant Finder" (arononeill's org, eu-west-1)
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqbWZia25qZWV3Z2NrbGxnYm5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2MjM1MzQsImV4cCI6MjEwNjE5OTUzNH0.lSty2yilPmghdM6cvkiISPJkJsFQAnvGBLrzBUjEYHU',  // anon public key (legacy JWT)
  operator: 'Easy Beans Coffee',
  operatorNif: '',                                       // TODO: Easy Beans SL CIF (appears on the representation template)
  operatorAddress: 'C. Pizarro 8, 29670 San Pedro de Alcántara (Málaga)',
  operatorEmail: 'easybeanscafe@gmail.com',
  commission: 0.03,   // must match RATE in supabase/functions/process-fees
  minFee: 150,        // must match MIN_FEE_CENTS/100 in process-fees
  diyPrice: 29        // shown as "free during beta (then €29)"
};
