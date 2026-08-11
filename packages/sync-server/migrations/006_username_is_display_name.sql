UPDATE accounts
SET username = 'Cai',
    display_name = 'Cai'
WHERE lower(username) = 'admin'
  AND role = 'admin';
