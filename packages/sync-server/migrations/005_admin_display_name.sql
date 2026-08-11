UPDATE accounts
SET display_name = 'Cai'
WHERE lower(username) = 'admin'
  AND role = 'admin'
  AND display_name = 'BinGO Admin';
