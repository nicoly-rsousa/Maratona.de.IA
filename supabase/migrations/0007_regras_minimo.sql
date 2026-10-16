-- Farol — 0007: exige ao menos uma regra de precedência (camada A), sobre 0006.
-- Idempotente: pode ser rodada mais de uma vez. Rode DEPOIS de 0006_regras_edicao.sql.
-- Não altera 0006: apenas redefine (create or replace) validar_conteudo_regras, chamada por salvar_regras,
-- para bloquear a gravação de um conjunto vazio. Desativar todas as regras continua permitido (ativa=false);
-- o que não é permitido é apagar o conjunto inteiro. Espelha validarRegras em packages/shared/src/regras-edicao.ts.

begin;

create or replace function validar_conteudo_regras(p_conteudo jsonb, p_pontuacao jsonb)
returns text[] language plpgsql stable set search_path = public as $$
declare
  v_erros text[] := '{}';
  v_r jsonb; v_c jsonb; v_o jsonb; v_crit jsonb;
  v_i int := 0;
  v_ids text[] := '{}';
  v_id text; v_rot text;
  v_vistos text[]; v_ops text[];
  v_nome_crit text; v_op text;
begin
  if jsonb_typeof(p_conteudo) is distinct from 'array' then
    return array['Conteúdo inválido: esperado uma lista de regras.'];
  end if;
  if jsonb_typeof(p_pontuacao -> 'criterios') is distinct from 'array' then
    return array['Versão de pontuação vigente inválida: sem critérios.'];
  end if;

  -- 0007: conjunto vazio é erro (mantenha ao menos uma regra; desative em vez de apagar todas).
  if jsonb_array_length(p_conteudo) = 0 then
    return array['Mantenha ao menos uma regra.'];
  end if;

  for v_r in select e from jsonb_array_elements(p_conteudo) e loop
    v_i := v_i + 1;
    if jsonb_typeof(v_r) is distinct from 'object' then
      v_erros := v_erros || format('Regra nº %s: formato inválido.', v_i);
      continue;
    end if;
    v_id := case when jsonb_typeof(v_r -> 'id') = 'string' then v_r ->> 'id' end;
    v_rot := format('Regra "%s"', coalesce(
      nullif(btrim(case when jsonb_typeof(v_r -> 'nome') = 'string' then v_r ->> 'nome' end), ''), nullif(btrim(v_id), ''), 'nº ' || v_i));

    if v_id is null or btrim(v_id) = '' then
      v_erros := v_erros || format('%s: informe o identificador.', v_rot);
    elsif v_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$' then
      v_erros := v_erros || format('%s: identificador inválido (letras, números, "-" e "_", até 40 caracteres).', v_rot);
    elsif v_id = any (v_ids) then
      v_erros := v_erros || format('Identificador repetido: "%s".', v_id);
    end if;
    if v_id is not null then v_ids := v_ids || v_id; end if;

    if jsonb_typeof(v_r -> 'nome') is distinct from 'string' or btrim(v_r ->> 'nome') = '' then
      v_erros := v_erros || format('%s: informe o nome.', v_rot);
    end if;
    if jsonb_typeof(v_r -> 'ativa') is distinct from 'boolean' then
      v_erros := v_erros || format('%s: "ativa" deve ser verdadeiro ou falso.', v_rot);
    end if;
    if jsonb_typeof(v_r -> 'nivel') is distinct from 'number' or (v_r ->> 'nivel') !~ '^([1-9]|10)$' then
      v_erros := v_erros || format('%s: o nível deve ser um inteiro de 1 a 10.', v_rot);
    end if;
    if jsonb_typeof(v_r -> 'prioridadeMinima') is distinct from 'number' or (v_r ->> 'prioridadeMinima') !~ '^[0-4]$' then
      v_erros := v_erros || format('%s: a prioridade mínima deve ser um inteiro de 0 a 4.', v_rot);
    end if;

    if jsonb_typeof(v_r -> 'cond') is distinct from 'array' or jsonb_array_length(v_r -> 'cond') = 0 then
      v_erros := v_erros || format('%s: informe pelo menos uma condição.', v_rot);
      continue;
    end if;

    v_vistos := '{}';
    for v_c in select e from jsonb_array_elements(v_r -> 'cond') e loop
      if jsonb_typeof(v_c) is distinct from 'object' or jsonb_typeof(v_c -> 'criterio') is distinct from 'string' then
        v_erros := v_erros || format('%s: condição com formato inválido.', v_rot);
        continue;
      end if;
      select e into v_crit from jsonb_array_elements(p_pontuacao -> 'criterios') e where e ->> 'id' = (v_c ->> 'criterio') limit 1;
      if v_crit is null then
        v_erros := v_erros || format('%s: o critério "%s" não existe na versão de pontuação vigente.', v_rot, v_c ->> 'criterio');
        continue;
      end if;
      v_nome_crit := coalesce(v_crit ->> 'nome', v_c ->> 'criterio');
      if (v_c ->> 'criterio') = any (v_vistos) then
        v_erros := v_erros || format('%s: o critério "%s" aparece mais de uma vez; reúna as opções numa só condição.', v_rot, v_nome_crit);
      end if;
      v_vistos := v_vistos || (v_c ->> 'criterio');

      if jsonb_typeof(v_c -> 'opcoes') is distinct from 'array' or jsonb_array_length(v_c -> 'opcoes') = 0 then
        v_erros := v_erros || format('%s: a condição em "%s" precisa de ao menos uma opção.', v_rot, v_nome_crit);
        continue;
      end if;
      v_ops := '{}';
      for v_o in select e from jsonb_array_elements(v_c -> 'opcoes') e loop
        if jsonb_typeof(v_o) is distinct from 'string' then
          v_erros := v_erros || format('%s: opção com formato inválido em "%s".', v_rot, v_nome_crit);
          continue;
        end if;
        v_op := v_o #>> '{}';
        if not exists (select 1 from jsonb_array_elements(v_crit -> 'opcoes') x where x ->> 'label' = v_op) then
          v_erros := v_erros || format('%s: a opção "%s" não existe em "%s".', v_rot, v_op, v_nome_crit);
        elsif v_op = any (v_ops) then
          v_erros := v_erros || format('%s: opção repetida em "%s": "%s".', v_rot, v_nome_crit, v_op);
        end if;
        v_ops := v_ops || v_op;
      end loop;
    end loop;
  end loop;
  return v_erros;
end $$;

-- Reafirma as permissões (create or replace preserva as existentes, mas fica explícito e idempotente).
revoke all on function validar_conteudo_regras(jsonb, jsonb) from public, anon, authenticated;
grant execute on function validar_conteudo_regras(jsonb, jsonb) to service_role;

commit;
