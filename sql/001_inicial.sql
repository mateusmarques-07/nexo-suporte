-- NEXO M | Suporte · esquema inicial (fase 1)
-- Demanda = um pedido de suporte. Mensagens e prints que o Mateus encaminha
-- em sequência (até 3 min de intervalo) caem na mesma demanda.

create table if not exists demandas (
  id            bigserial primary key,          -- número curto: #12
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  origem        text not null default 'whatsapp' check (origem in ('whatsapp','mesa')),
  solicitante   text,                           -- quem pediu (setor/pessoa), preenchido pelo Mateus
  status        text not null default 'recebida'
                check (status in ('recebida','entendida','aguardando_ok','corrigindo','corrigida','respondida','arquivada','erro')),
  tipo          text check (tipo in ('rt','trib','ibs','corte','rej','canc','outro')),
  comando       text,                           -- atalho normalizado, ex.: "rt 6148 vanessa"
  params        jsonb not null default '{}'::jsonb,
  resumo        text,                           -- frase legível do que foi pedido
  sugestao      text,                           -- atalho sugerido pela leitura do print
  resposta      text,                           -- texto pro time
  respondida_em timestamptz,
  ultima_atividade timestamptz not null default now()
);
create index if not exists demandas_status_idx on demandas (status, created_at desc);

create table if not exists mensagens (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  demanda_id  bigint references demandas(id) on delete cascade,
  direcao     text not null check (direcao in ('entrada','saida')),
  wa_id       text unique,                      -- id da mensagem no WhatsApp (evita duplicar)
  tipo        text not null default 'texto',   -- texto | imagem | documento | outro
  texto       text,
  raw         jsonb
);
create index if not exists mensagens_demanda_idx on mensagens (demanda_id, created_at);

create table if not exists anexos (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  demanda_id   bigint not null references demandas(id) on delete cascade,
  mensagem_id  uuid references mensagens(id) on delete set null,
  storage_path text not null,
  mimetype     text,
  ocr_status   text not null default 'pendente' check (ocr_status in ('pendente','ok','erro','ignorado')),
  ocr_texto    text,
  ocr_dados    jsonb
);
create index if not exists anexos_ocr_idx on anexos (ocr_status) where ocr_status = 'pendente';

-- histórico de tudo que aconteceu numa demanda
create table if not exists eventos (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  demanda_id  bigint references demandas(id) on delete cascade,
  tipo        text not null,
  detalhe     jsonb not null default '{}'::jsonb
);
create index if not exists eventos_demanda_idx on eventos (demanda_id, created_at);

-- soluções conhecidas e quanto cada uma faz sozinha
create table if not exists solucoes (
  chave      text primary key,
  nome       text not null,
  descricao  text,
  modo       text not null default 'ok' check (modo in ('auto','eu','ok','fixo')),
  pronta     boolean not null default false,   -- correção automática já construída e testada?
  ordem      int not null default 0
);
insert into solucoes (chave, nome, descricao, modo, ordem) values
  ('rt',    'Trocar RT da etiqueta',      'Troca o responsável técnico das empresas 6024 e 6148.', 'ok', 1),
  ('trib',  'Duplicar tributação',        'Copia a tributação de um item que já entrou na nota pro item com erro.', 'ok', 2),
  ('ibs',   'IBS/CBS (Edição Expressa)',  'Configura CST 000 ou 410 em todas as empresas e exclui o faturamento da venda.', 'ok', 3),
  ('corte', 'Produto de corte',           'Duplica o produto e põe CORTE no nome, no grupo e na unidade.', 'ok', 4),
  ('rej',   'Rejeição nova',              'Analisa o erro e sugere a correção.', 'fixo', 5),
  ('canc',  'Cancelar nota',              'Só com pedido do Mateus e o número da nota digitado.', 'fixo', 6)
on conflict (chave) do nothing;

-- saúde das peças (uazapi, worker do VPS)
create table if not exists saude (
  chave         text primary key,
  status        text not null,
  verificado_em timestamptz not null default now(),
  detalhe       jsonb not null default '{}'::jsonb
);

-- Pega a demanda aberta mais recente (atividade nos últimos 3 min) ou abre uma nova.
-- O lock evita que texto + prints chegando juntos abram duas demandas.
create or replace function pegar_ou_abrir_demanda(janela_min int default 3, forcar_nova boolean default false)
returns table (demanda_id bigint, nova boolean)
language plpgsql security definer set search_path = public as $$
declare d bigint;
begin
  perform pg_advisory_xact_lock(424242);
  if not forcar_nova then
    select id into d from demandas
     where origem = 'whatsapp'
       and status in ('recebida','entendida')
       and ultima_atividade > now() - make_interval(mins => janela_min)
     order by ultima_atividade desc limit 1;
  end if;
  if d is not null then
    update demandas set ultima_atividade = now(), updated_at = now() where id = d;
    return query select d, false;
  else
    insert into demandas default values returning id into d;
    return query select d, true;
  end if;
end $$;
revoke all on function pegar_ou_abrir_demanda(int, boolean) from public, anon, authenticated;

-- RLS: só usuários logados (o Mateus) leem/alteram pela mesa.
-- Webhook e worker usam a secret key, que passa por cima do RLS.
alter table demandas  enable row level security;
alter table mensagens enable row level security;
alter table anexos    enable row level security;
alter table eventos   enable row level security;
alter table solucoes  enable row level security;
alter table saude     enable row level security;
do $$
declare t text;
begin
  foreach t in array array['demandas','mensagens','anexos','eventos','solucoes','saude'] loop
    execute format('drop policy if exists "logado_tudo" on %I', t);
    execute format('create policy "logado_tudo" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- bucket privado dos prints
insert into storage.buckets (id, name, public) values ('anexos', 'anexos', false)
on conflict (id) do nothing;
drop policy if exists "anexos_logado_le" on storage.objects;
create policy "anexos_logado_le" on storage.objects for select to authenticated using (bucket_id = 'anexos');
