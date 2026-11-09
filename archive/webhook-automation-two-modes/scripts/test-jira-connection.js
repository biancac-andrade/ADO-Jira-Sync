#!/usr/bin/env node
/**
 * Testa se as variáveis JIRA_* do .env conseguem acessar uma issue.
 * Uso: node scripts/test-jira-connection.js [ISSUE_KEY]
 * Ex.: node scripts/test-jira-connection.js BEESEDI-1
 */
require('dotenv').config();

const issueKey = process.argv[2] || 'BEESEDI-1';
const base = (process.env.JIRA_BASE_URL || '').replace(/\/$/, '');
const user = process.env.JIRA_USER_EMAIL || '';
const token = process.env.JIRA_API_TOKEN || '';

if (!base || !user || !token) {
  console.error('Defina JIRA_BASE_URL, JIRA_USER_EMAIL e JIRA_API_TOKEN no .env');
  process.exit(1);
}

const auth = Buffer.from(`${user}:${token}`).toString('base64');
const urlIssue = `${base}/rest/api/3/issue/${issueKey}`;
const urlTransitions = `${base}/rest/api/3/issue/${issueKey}/transitions`;

console.log('1) Testando leitura da issue:', urlIssue);
console.log('   Token length:', token.length, '(espacos no fim podem causar 401)\n');

fetch(urlIssue, {
  method: 'GET',
  headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
})
  .then((res) => res.text().then((body) => ({ status: res.status, body })))
  .then(({ status, body }) => {
    if (status === 200) {
      console.log('   Status: 200 OK – você tem permissão para ver a issue.\n');
      console.log('2) Testando transições:', urlTransitions);
      return fetch(urlTransitions, {
        method: 'GET',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      }).then((r) => r.text().then((b) => ({ status: r.status, body: b })));
    }
    console.log('   Status:', status);
    console.log('   Resposta:', body);
    if (status === 401) console.log('\n→ 401: e-mail ou token inválido. Gere um novo token em https://id.atlassian.com/manage-profile/security/api-tokens');
    if (status === 404) {
      console.log('\n→ 404: a conta', user, 'não enxerga a issue BEESEDI-1.');
      console.log('   - Abra https://heydev.atlassian.net/browse/BEESEDI-1 no navegador **logado com o mesmo e-mail** do .env.');
      console.log('   - Se não abrir: adicione esse usuário ao Space/projeto ou use um token de quem já tem acesso.');
    }
    process.exit(1);
  })
  .then((result) => {
    if (!result) return;
    const { status, body } = result;
    if (status === 200) {
      const data = JSON.parse(body);
      const names = (data.transitions || []).map((t) => t.name).join(', ');
      console.log('   Status: 200 OK. Transições disponíveis:', names || '(nenhuma)');
      return;
    }
    console.log('   Status:', status, body);
    if (status === 404) console.log('\n→ Transições: 404 – sem permissão para mudar status nessa issue.');
  })
  .catch((err) => {
    console.error('Erro:', err.message);
    process.exit(1);
  });
