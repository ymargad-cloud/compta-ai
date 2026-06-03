-- ============================================================
-- ComptaAI — Script SQL à coller dans Supabase SQL Editor
-- ============================================================

-- 1. UTILISATEURS
CREATE TABLE IF NOT EXISTS users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT UNIQUE NOT NULL,
  password   TEXT NOT NULL,
  nom        TEXT NOT NULL,
  prenom     TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'comptable',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. SOCIÉTÉS
CREATE TABLE IF NOT EXISTS companies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  ice          TEXT,
  ville        TEXT,
  portal_token TEXT UNIQUE DEFAULT gen_random_uuid()::TEXT,
  owner_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ACCÈS UTILISATEUR → SOCIÉTÉ
CREATE TABLE IF NOT EXISTS user_companies (
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, company_id)
);

-- 4. DOCUMENTS
CREATE TABLE IF NOT EXISTS documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID REFERENCES companies(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  original_name TEXT NOT NULL,
  doc_type      TEXT,
  status        TEXT DEFAULT 'pending',
  from_client   BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 5. FACTURES
CREATE TABLE IF NOT EXISTS factures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES companies(id) ON DELETE CASCADE,
  document_id     UUID REFERENCES documents(id) ON DELETE SET NULL,
  numero          TEXT,
  date_facture    DATE,
  fournisseur     TEXT,
  fournisseur_ice TEXT,
  categorie       TEXT,
  description     TEXT,
  montant_ht      NUMERIC(15,2) DEFAULT 0,
  taux_tva        NUMERIC(5,2)  DEFAULT 20,
  montant_tva     NUMERIC(15,2) DEFAULT 0,
  montant_ttc     NUMERIC(15,2) DEFAULT 0,
  devise          TEXT DEFAULT 'MAD',
  statut          TEXT DEFAULT 'a_valider',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 6. RELEVÉS
CREATE TABLE IF NOT EXISTS releves (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID REFERENCES companies(id) ON DELETE CASCADE,
  document_id    UUID REFERENCES documents(id) ON DELETE SET NULL,
  banque         TEXT,
  compte         TEXT,
  periode_debut  DATE,
  periode_fin    DATE,
  solde_initial  NUMERIC(15,2) DEFAULT 0,
  solde_final    NUMERIC(15,2) DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- 7. TRANSACTIONS
CREATE TABLE IF NOT EXISTS transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES companies(id) ON DELETE CASCADE,
  releve_id       UUID REFERENCES releves(id) ON DELETE CASCADE,
  date_operation  DATE,
  libelle         TEXT,
  type_mouvement  TEXT,
  montant         NUMERIC(15,2) DEFAULT 0,
  solde           NUMERIC(15,2),
  rapprochee      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 8. ADMIN PAR DÉFAUT (changez le mot de passe après connexion)
-- mot de passe : Admin1234  (hashé bcrypt)
INSERT INTO users (email, password, nom, prenom, role)
VALUES (
  'admin@comptaai.com',
  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
  'Admin',
  'ComptaAI',
  'admin'
) ON CONFLICT (email) DO NOTHING;

-- Vérification
SELECT 'Tables créées avec succès ✓' AS message;
