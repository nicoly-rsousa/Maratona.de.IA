# Dicionário de dados — bases em `docs/dados`

> Resultado da análise dos arquivos enviados. O que está marcado como **verificado** foi conferido nos dados; **[A CONFIRMAR]** é inferência e precisa de validação da operação.

## 0. Cuidados gerais

- `Clientes Maratona.csv` tem ~330 MB e **dados pessoais** (nome, endereço, medidor). Não versionar no Git (limite de 100 MB por arquivo do GitHub) e não importar colunas pessoais. Colocar `docs/dados/*.csv` no `.gitignore`.
- Importar para o banco apenas **agregados** por circuito e por transformador.
- Os nomes dos arquivos no repositório têm espaços (`Clientes Maratona.csv`); nas análises os arquivos tinham underscore. Os conteúdos são os mesmos.

## 1. OS de manutenção pendente (`OS manutenção pendente.xlsx`)

**Formato (verificado):** 1 aba (`OS manutenção pendente`), 4.513 linhas, 95 colunas. `OSNumero` e `OS(int)` são únicos. Todas as OS têm `CodEstado = CRIADA` e `DataCriação` em 2026.

| Campo | Uso | Observação |
|---|---|---|
| `OSNumero` | número da OS | único |
| `OS(int)` | id interno | único |
| `CodSetor` | **alimentador / circuito** | 158 valores; ver seção 5 |
| `Trecho` | 1, 2 ou 3 (19 vazios) | provável classificação T1/T2/T3 **[A CONFIRMAR]** |
| `CodPrioridade` | prioridade legada | 10 valores, ver abaixo |
| `DescEsquema` | tipo do serviço | 26 tipos; mais comuns: Manutenção corretiva estrutura de MT (2.300), Poda MT (708), Manutenção corretiva (436), Isolador MT (363), Limpeza de faixa manual (240) |
| `Familias` / `Descrição Ativo` | tipo do ativo | 23 famílias; mais comuns: poste concreto duplo T (2.398), poste concreto circular (1.757) |
| `Observação` | texto do defeito | ex.: cruzeta rachada |
| `DataDeadline` | prazo-limite | formato `dd/mm/aaaa hh:mm:ss` |
| `DataCriação`, `DataPrevista` | datas | mesmo formato |
| `Quantidade clientes` | clientes na abrangência | **ver armadilha 2** |
| `Delta IPDT` | indicador | decimal com vírgula (`0,8085`); 3.598 preenchidos; significado **[A CONFIRMAR]** |
| `Localidade` | município + código | ex.: `MURIAE 48-160`; município vem do texto, código vem depois |
| `Município` | — | **vazia** |
| `Processo` | R (4.415), U (97), P (1) | provável rural/urbano **[A CONFIRMAR]** |
| `SOMA` | Sim (1.441) / Não (3.072) | significado **[A CONFIRMAR]** |
| `COORDENADA UTM X` / `Y` | posição | preenchidas em 100% |
| `LATITUDE` / `LONGITUDE` (SIRGAS) | — | **vazias** |
| `CATEGORIA DE SERVIÇO`, `ACESSO`, `EQUIPE EXECUTORA` | — | preenchidas em 2.020 OS |
| `INSPETOR` | — | preenchido em 2.000 OS |

**Valores de `CodPrioridade` vistos (8 de 10):** EMERGENCIAL (130), URGENTE (674), <2 DIAS (492), <5 DIAS (541), ALTA (922), <15 DIAS (809), <30 DIAS (268), BAIXA (675). Verificar os outros 2 na importação. A prioridade legada é **informativa**; o Farol recalcula pelas camadas A e B.

**Mapa demonstrativo (não oficial) para o código Farol:** EMERGENCIAL → Emergente; URGENTE e <2 DIAS → Urgente; <5 DIAS e ALTA → Alta; <15 DIAS e <30 DIAS → Média; BAIXA → Baixa.

**Colunas praticamente vazias** (ignorar na importação): `Plano Trabalho`, `Num. Obra`, `Status Obra`, `Sequência de Bloco`, `Sigla Atividade Contrato`, as colunas de medidas de fundação/aterramento e outras do final da planilha.

## 2. Base de chaves da rede (`FIS_EMG_2026_07_E_CHAVES_ID`)

**Formato (verificado):** 82.328 linhas, 239 circuitos, 48 colunas.

| Campo | Uso |
|---|---|
| `CIRCUITO` | circuito (mesmo formato de `CodSetor`) |
| `CONJUNTO` | conjunto elétrico (81.134 preenchidos) |
| `TIPO` | tipo de chave: FU (65.497), CF (14.585), FR (1.543), CL (552), CS (133), CT (13), CA (5) |
| `ID_ATIVO`, `ID_INSTALACAO`, `NUMERO_OPERATIVO` | identificadores |
| `LAT_0`, `LONG_0` | coordenadas em graus decimais, **sem nenhum vazio** — usar estas |
| `COORD_X0`, `COORD_Y0` | UTM **multiplicado por 1000** (ver armadilha 3) |

## 3. Base de clientes (`Clientes Maratona.csv`)

**Formato (verificado):** 988.729 linhas, 265 circuitos, codificação **latin-1** (ISO-8859), fim de linha CRLF, **vírgula como decimal** (`LAT` = `-22,216944`).

| Campo | Uso | Observação |
|---|---|---|
| `CIRCUITO`, `CONJUNTO` | ligação com a rede | |
| `TRANSFORMADOR` | texto, não número | ver REGRADENEGOCIO seção 12 |
| `SITUACAO` | LIG (657.639) / DES (331.090) | |
| `CLASSE` | residencial 820.581; rural 77.385; comercial 74.316; industrial 7.422; poder público 6.962; serviço público 1.371; iluminação pública 404; consumo próprio 288 | |
| `LAT`, `LONG`, `COORD_X`, `COORD_Y` | posição | ~76% preenchidos |
| `COD_POSTE` | poste | ~76% preenchido |

**Colunas pessoais — não importar:** `NOME`, `ENDERECO`, `BAIRRO`, `MEDIDOR`, `NUMCDC`, `NUM_CONTA`, `NUM_ROTA`, `NUM_LIVRO`, `NUM_CASA`, `ID_PONTO_ENTREGA`, `ID_RAMAL`.

## 4. Armadilhas de importação

1. **Coordenadas da OS estão em UTM, não em graus.** Sistema: SIRGAS 2000 / UTM zona 23S (**EPSG:31983**). Converter para EPSG:4674 (ou 4326). Verificado: a conversão reproduz exatamente o `LAT_0/LONG_0` da base de chaves, e as OS caem na Zona da Mata de MG (lat −22,43 a −20,00; lng −43,24 a −41,77).
2. **`Quantidade clientes`: a vírgula parece ser milhar.** Todos os 1.968 valores com vírgula têm exatamente 3 dígitos depois dela (`1,332`, `2,769`). Interpretar como 1.332 e 2.769 **[A CONFIRMAR]**. Já `Delta IPDT` usa vírgula decimal. Converter cada coluna com sua própria regra, nunca com um conversor único.
3. **`COORD_X0/Y0` da base de chaves vêm ×1000.** Preferir `LAT_0/LONG_0`.
4. **Codificação:** ler o CSV de clientes como latin-1 com `decimal=","`.
5. **Datas:** `dd/mm/aaaa hh:mm:ss`, fuso local.
6. **Códigos como texto:** `CodSetor`, `CodLocalização`, `Abrangência`, `TRANSFORMADOR` têm zeros à esquerda; nunca converter para número.

## 5. Ligações entre as bases

| Ligação | Resultado |
|---|---|
| OS `CodSetor` ↔ `CIRCUITO` da base de chaves | **funciona**: 153 dos 158 códigos, 99,1% das OS |
| OS `CodSetor` ↔ `CIRCUITO` de clientes | **funciona**: 154 códigos, 99,5% das OS |
| OS `CodAtivo` / `Código Externo` ↔ `COD_POSTE` | **não funciona** (0%) |
| OS `Abrangência` / `CodLocalização` ↔ `CONJUNTO` de clientes | **não funciona** (0%) |

**Consequência:** ligar OS a cliente **por circuito**; para localização fina, usar **proximidade** ao transformador ou chave mais próxima, não ID de ativo.

**Códigos de `CodSetor` sem correspondência na base de chaves:** `CET-LUM 2`, `CET-LUM 3`, `CET-LUM 4`, `CQT1-CQT`, `ERA-ERA2`. Parecem variações de grafia. **Não corrigir automaticamente**: marcar como "circuito não identificado", listar no relatório de qualidade e deixar a correção para a operação.

**Ainda não testado:** `Abrangência` contra `ID_INSTALACAO` / `NUMERO_OPERATIVO` da base de chaves; o arquivo `FIS_EMG_2026_07_E_MEDIDORES 1.csv` (não analisado).

## 6. Regional

Nenhuma base traz regional. Criar a tabela `regional (municipio, regional)`; sugestão inicial: extrair o município de `Localidade` (`MURIAE 48-160` → `MURIAE`) e deixar a regional para um administrador preencher. Maiores localidades: Muriaé (974 OS), Ubá (483), Leopoldina (453), Cataguases (221), Manhuaçu (190).

## 7. Relatório de qualidade esperado na importação

- OS sem circuito conhecido (e a lista de códigos).
- OS sem coordenada.
- OS fora do retângulo do circuito (bbox da base de chaves + margem de ~0,1°).
- Valores de prioridade legada sem mapa.
- Transformadores sem coordenada.
- Contagens por tabela (linhas lidas × linhas gravadas).
