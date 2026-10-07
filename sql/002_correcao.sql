-- NEXO M | Suporte · fase 2: correção automática no Sempre
-- O worker só executa demandas com correcao_pedida_em recente (até 30 min).
-- Quem marca é o atalho/ok do Mateus (WhatsApp ou mesa) e só quando a solução está pronta.
-- "Reabrir" ou mudar status na mesa NÃO marca, então nada antigo roda por acidente.
alter table demandas add column if not exists correcao_pedida_em timestamptz;
create index if not exists demandas_correcao_idx on demandas (correcao_pedida_em) where correcao_pedida_em is not null;

-- solucoes.pronta é ligada à mão depois do teste real de cada solução:
--   update solucoes set pronta = true where chave = 'rt';
