import test from 'node:test';
import assert from 'node:assert/strict';
import {
  utmParaGraus, quantidadeMilhar, decimalVirgula, dataBR, municipioDeLocalidade, texto,
  assertCamposPermitidos, CAMPOS_PERMITIDOS, COLUNAS_PROIBIDAS, wktPonto, wktLinha, segmentosDoGeojson, destinoLocal,
} from './lib.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('UTM EPSG:31983 → graus reproduz a base de chaves (par conhecido)', () => {
  const r = utmParaGraus(761810.0, 7535291.0);
  assert.ok(Math.abs(r.lat - -22.268155) < 1e-5, `lat=${r.lat}`);
  assert.ok(Math.abs(r.lng - -42.459386) < 1e-5, `lng=${r.lng}`);
});

test('UTM aceita texto e rejeita vazio/zero/não numérico', () => {
  assert.ok(utmParaGraus('761810', '7535291'));
  assert.equal(utmParaGraus('', '7535291'), null);
  assert.equal(utmParaGraus('0', '0'), null);
  assert.equal(utmParaGraus('abc', '1'), null);
});

test('"Quantidade clientes": vírgula é milhar', () => {
  assert.equal(quantidadeMilhar('1,332'), 1332);
  assert.equal(quantidadeMilhar('2,769'), 2769);
  assert.equal(quantidadeMilhar('1,234,567'), 1234567);
  assert.equal(quantidadeMilhar('85'), 85);
  assert.equal(quantidadeMilhar(''), null);
  assert.equal(quantidadeMilhar('1,33'), null); // não é milhar: não adivinha
});

test('decimal com vírgula (LAT do CSV de clientes, Delta IPDT)', () => {
  assert.equal(decimalVirgula('-22,216944'), -22.216944);
  assert.equal(decimalVirgula('0,8085'), 0.8085);
  assert.equal(decimalVirgula(''), null);
  assert.equal(decimalVirgula('1,332,1'), null);
});

test('data dd/mm/aaaa hh:mm:ss com fuso local', () => {
  assert.equal(dataBR('08/06/2026 16:32:31'), '2026-06-08T16:32:31-03:00');
  assert.equal(dataBR('31/13/2026 00:00:00'), null);
  assert.equal(dataBR(''), null);
});

test('município vem do texto de Localidade', () => {
  assert.equal(municipioDeLocalidade('MURIAE 48-160'), 'MURIAE');
  assert.equal(municipioDeLocalidade('MURY / NOVA FRIBURGO 257-1'), 'MURY / NOVA FRIBURGO');
  assert.equal(municipioDeLocalidade(''), null);
});

test('códigos permanecem texto (zeros à esquerda)', () => {
  assert.equal(texto('00123'), '00123');
  assert.equal(texto('  TCT-002 '), 'TCT-002');
});

test('privacidade: campo fora da lista aborta', () => {
  assert.doesNotThrow(() => assertCamposPermitidos('rede_transformadores',
    [{ circuito: 'A', transformador: '0012', clientes: 3 }]));
  assert.throws(() => assertCamposPermitidos('rede_transformadores',
    [{ circuito: 'A', transformador: '0012', nome: 'X' }]), /privacidade/);
  assert.throws(() => assertCamposPermitidos('os_importadas', [{ numero: '1', observacao: 'x' }]), /privacidade/);
});

test('privacidade: nenhuma coluna pessoal está na lista de permissão', () => {
  const todos = Object.values(CAMPOS_PERMITIDOS).flat().map((c) => c.toUpperCase());
  for (const p of COLUNAS_PROIBIDAS) assert.ok(!todos.includes(p), `${p} não pode ser permitido`);
});

test('WKT: ordem é (lng lat), como o ST_MakePoint do PostGIS', () => {
  assert.equal(wktPonto(-22.268155, -42.459386), 'SRID=4326;POINT(-42.459386 -22.268155)');
  assert.equal(wktLinha([[-42.5, -21.5], [-42.6, -21.6]]), 'SRID=4326;LINESTRING(-42.5 -21.5,-42.6 -21.6)');
});

const feat = (over = {}, geom) => ({
  type: 'Feature',
  geometry: geom ?? { type: 'LineString', coordinates: [[-42.593833, -21.508799], [-42.59444, -21.508841]] },
  properties: { id: '1', rede: 'MV', uso: 'Ramal', trecho: '3', dono: 'Energisa', alimentador: 'LPD-5', ...over },
});

test('traçado: segmento válido vira linha; trecho texto vira inteiro', () => {
  const { rows, q } = segmentosDoGeojson({ features: [feat()] }, 'LPD-5', new Set());
  assert.equal(q.lidos, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].trecho, 3);
  assert.equal(rows[0].rede, 'MV');
  assert.match(rows[0].geom, /^SRID=4326;LINESTRING\(-42\.593833 -21\.508799,/);
});

test('traçado: LV com trecho 3 é aceito e mantém trecho 3 (cor pelo trecho)', () => {
  const { rows } = segmentosDoGeojson({ features: [feat({ rede: 'LV', trecho: '3' })] }, 'LPD-5', new Set());
  assert.equal(rows[0].rede, 'LV');
  assert.equal(rows[0].trecho, 3);
});

test('traçado: id duplicado (mesmo arquivo ou outro) é rejeitado e contado', () => {
  const vistos = new Set();
  const a = segmentosDoGeojson({ features: [feat({ id: '9' }), feat({ id: '9' })] }, 'LPD-5', vistos);
  assert.equal(a.rows.length, 1);
  assert.equal(a.q.id_duplicado, 1);
  const b = segmentosDoGeojson({ features: [feat({ id: '9', alimentador: 'LPD-6' })] }, 'LPD-6', vistos);
  assert.equal(b.rows.length, 0);
  assert.equal(b.q.id_duplicado, 1);
});

test('traçado: rejeita alimentador diferente do arquivo, trecho/rede inválidos, geometria ruim e fora da região', () => {
  const fe = [
    feat({ id: 'a', alimentador: 'OUTRO' }),
    feat({ id: 'b', trecho: '7' }),
    feat({ id: 'c', rede: 'XX' }),
    feat({ id: 'd' }, { type: 'Point', coordinates: [-42.5, -21.5] }),
    feat({ id: 'e' }, { type: 'LineString', coordinates: [[10, 10], [11, 11]] }),
    feat({ id: null }),
  ];
  const { rows, q } = segmentosDoGeojson({ features: fe }, 'LPD-5', new Set());
  assert.equal(rows.length, 0);
  assert.equal(q.lidos, 6);
  assert.equal(q.alimentador_diferente_do_arquivo, 1);
  assert.equal(q.trecho_invalido, 1);
  assert.equal(q.rede_invalida, 1);
  assert.equal(q.geometria_invalida, 1);
  assert.equal(q.fora_da_regiao, 1);
  assert.equal(q.sem_id, 1);
});

test('trava: aceita só destino local (127.0.0.1/localhost, porta 54322)', () => {
  for (const u of ['http://127.0.0.1:54322', 'http://localhost:54322',
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres', 'http://LOCALHOST:54322/rest/v1']) {
    assert.equal(destinoLocal(u).ok, true, u);
  }
});

test('trava: recusa hosts remotos, supabase.co e truques de URL', () => {
  const remotos = [
    'https://abcdefghijklmnop.supabase.co', 'https://abcdefghijklmnop.supabase.co:54322', 'https://db.abcdefghijklmnop.supabase.co:5432',
    'https://pooler.supabase.com:6543', 'http://example.com:54322', 'http://192.168.0.10:54322', 'http://10.0.0.5:54322',
    'http://0.0.0.0:54322', 'http://[::1]:54322', 'http://127.0.0.2:54322',
    'http://localhost.supabase.co:54322', 'http://127.0.0.1.nip.io:54322', 'http://localhost.evil.com:54322',
    'http://localhost@evil.com:54321', 'http://127.0.0.1@abcdefghijklmnop.supabase.co:54322',
    'http://evil.com/127.0.0.1:54321', 'http://evil.com?h=localhost:54321',
  ];
  for (const u of remotos) assert.equal(destinoLocal(u).ok, false, u);
});

test('trava: recusa porta errada, protocolo estranho, vazio e lixo', () => {
  for (const u of ['http://127.0.0.1', 'http://127.0.0.1:5432', 'http://localhost:3000', 'http://localhost:54321', 'ftp://127.0.0.1:54322',
    'file:///etc/passwd', '', '   ', 'não é url', 'localhost:54321', undefined, null, 54321]) {
    assert.equal(destinoLocal(u).ok, false, String(u));
  }
});

test('trava no processo: --gravar com URL remota aborta antes de ler arquivos ou conectar', () => {
  const script = fileURLToPath(new URL('./importar.mjs', import.meta.url));
  const alvos = ['https://abcdefghijklmnop.supabase.co', 'https://example.com:54322', 'http://localhost.supabase.co:54321', ''];
  for (const url of alvos) {
    // --dados inexistente: se a trava rodasse DEPOIS da leitura, o erro seria outro (ENOENT, status 1), não o bloqueio (status 2).
    const r = spawnSync(process.execPath, [script, '--gravar', '--dados', '/pasta/que/nao/existe'], {
      env: { PATH: process.env.PATH, DATABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'chave-falsa-de-teste' },
      encoding: 'utf8', timeout: 60000,
    });
    assert.equal(r.status, 2, `status para "${url}": ${r.status} ${r.stderr}`);
    assert.match(r.stderr, /BLOQUEADA/);
    assert.match(r.stderr, /Nada foi lido nem gravado/);
    assert.ok(!/ENOENT|Lendo /.test(r.stderr), 'não pode ter começado a ler arquivos');
    assert.ok(!r.stderr.includes('chave-falsa-de-teste'), 'a chave não pode vazar na mensagem');
  }
});

test('trava no processo: --atualizar-regional --gravar também é bloqueado com URL remota', () => {
  const script = fileURLToPath(new URL('./importar.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script, '--atualizar-regional', '--gravar', '--dados', '/pasta/que/nao/existe'], {
    env: { PATH: process.env.PATH, DATABASE_URL: 'https://abcdefghijklmnop.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'x' },
    encoding: 'utf8', timeout: 60000,
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /BLOQUEADA/);
});

test('privacidade: rede_tracado só aceita os campos permitidos', () => {
  assert.doesNotThrow(() => assertCamposPermitidos('rede_tracado', [{ circuito: 'A', id_segmento: '1', rede: 'MV', trecho: 1, geom: 'x' }]));
  assert.throws(() => assertCamposPermitidos('rede_tracado', [{ circuito: 'A', nome: 'x' }]), /privacidade/);
});
