# Flight Data Recorder PWA

PWA offline em HTML, CSS e JavaScript para registar pontos GPS e detectar fases de voo.

## Objectivo

A app tenta preencher automaticamente um log com:

- taxi
- takeoff roll
- take-off
- take off climb
- climb
- TOC
- cruise
- TOD
- Descent
- Approach
- Landing
- Landing roll
- taxi

A detecção é feita apenas com `navigator.geolocation.watchPosition()`, usando velocidade, altitude GPS e timestamps.

## Limitações importantes

- Em iPhone, uma PWA não deve ser considerada fiável com o ecrã bloqueado.
- Mantém a app aberta e o ecrã ligado durante a gravação.
- O GPS pode funcionar sem internet, mas mapas online não carregam offline.
- `speed`, `altitude` e `heading` podem vir como `null`, dependendo do dispositivo e do browser.
- Este projecto é um protótipo técnico e não deve ser usado como instrumento primário de navegação.

## Ficheiros

- `index.html`: estrutura da interface.
- `styles.css`: estilos visuais.
- `app.js`: lógica GPS, algoritmo de fases, exportação e IndexedDB.
- `manifest.webmanifest`: configuração PWA.
- `sw.js`: service worker para funcionamento offline.
- `icons/`: ícones da PWA.

## Como correr localmente

A Geolocation API exige HTTPS ou `localhost`.

### Opção simples com Python

```bash
# Entra na pasta do projecto.
cd flight-data-recorder-pwa

# Inicia um servidor local simples na porta 8080.
python3 -m http.server 8080
```

Depois abre:

```text
http://localhost:8080
```

### Opção com Node.js

```bash
# Instala um servidor estático simples sem alterar o projecto.
npx serve .
```

## Como publicar no GitHub Pages

1. Cria um repositório novo no GitHub.
2. Envia estes ficheiros para o repositório.
3. Vai a **Settings > Pages**.
4. Em **Build and deployment**, escolhe **Deploy from a branch**.
5. Escolhe a branch `main` e a pasta `/root`.
6. Abre o URL gerado pelo GitHub Pages.

## Sugestão de comandos Git

```bash
# Inicia um repositório Git local.
git init

# Adiciona todos os ficheiros ao stage.
git add .

# Cria o primeiro commit.
git commit -m "Initial PWA flight data recorder"

# Define a branch principal como main.
git branch -M main

# Liga o repositório local ao teu repositório GitHub.
git remote add origin https://github.com/TEU-USER/flight-data-recorder-pwa.git

# Envia o projecto para o GitHub.
git push -u origin main
```

## Próximos passos técnicos

- Adicionar calibração manual de altitude do aeródromo.
- Adicionar botão para corrigir fases manualmente.
- Adicionar exportação PDF.
- Adicionar importação de sessões antigas.
- Melhorar algoritmo com filtros por média móvel.
- Criar versão Capacitor para iPhone com background location.
