# Flight Data Recorder PWA v2

PWA offline em HTML, CSS e JavaScript para registar pontos GPS, detectar fases de voo e calcular consumo aproximado.

## Estados registados

A app cria um log com:

- blocks off
- taxi
- takeoff
- initial climb
- climb
- TOC
- cruise
- TOD
- descent
- approach
- landing
- taxi
- blocks on

A tabela principal mostra:

- Status
- Start Time
- Consumption

O `end_time` continua a existir internamente e no CSV/JSON para permitir calcular consumo por fase.

## Consumo padrão

- Até ao TOC: `720 lb/h`
- Cruise: `600 lb/h`
- Descent / approach / landing / taxi final: `580 lb/h`

Estes valores podem ser alterados no separador **Settings**.

## Auto-stop

Depois de landing, quando a app entra no taxi final e a velocidade fica perto de zero durante o tempo configurado, aparece uma pergunta:

```text
A velocidade está perto de zero no taxi final. O voo terminou e queres fazer Blocks on?
```

Se confirmares, a app pára a gravação e cria o evento `blocks on`.

## Correcção aplicada ao bug de Descent

A versão anterior podia ficar presa em `Descent` porque dependia da altitude do aeródromo de partida para reconhecer aproximação/aterragem. Esta versão remove essa dependência. Agora a passagem para `approach` e `landing` usa principalmente:

- estado anterior;
- existência de TOD/descent;
- velocidade;
- tendência vertical.

## Limitações importantes

- Em iPhone, uma PWA não deve ser considerada fiável com o ecrã bloqueado.
- Mantém a app aberta e o ecrã ligado durante a gravação.
- O GPS pode funcionar sem internet, mas a app tem de ter sido aberta pelo menos uma vez para ficar em cache offline.
- `speed`, `altitude` e `heading` podem vir como `null`, dependendo do dispositivo e do browser.
- Este projecto é um protótipo técnico e não deve ser usado como instrumento primário de navegação.

## Como correr localmente

A Geolocation API exige HTTPS ou `localhost`.

```bash
# Entra na pasta do projecto.
cd flight-data-recorder-pwa-v2

# Inicia um servidor local simples na porta 8080.
python3 -m http.server 8080
```

Depois abre:

```text
http://localhost:8080
```

## Como publicar no GitHub Pages

1. Cria um repositório novo no GitHub.
2. Envia estes ficheiros para o repositório.
3. Vai a **Settings > Pages**.
4. Em **Build and deployment**, escolhe **Deploy from a branch**.
5. Escolhe a branch `main` e a pasta `/root`.
6. Abre o URL gerado pelo GitHub Pages.

## Comandos Git sugeridos

```bash
# Inicia um repositório Git local.
git init

# Adiciona todos os ficheiros ao stage.
git add .

# Cria o primeiro commit.
git commit -m "Initial PWA flight data recorder v2"

# Define a branch principal como main.
git branch -M main

# Liga o repositório local ao teu repositório GitHub.
git remote add origin https://github.com/TEU-USER/flight-data-recorder-pwa.git

# Envia o projecto para o GitHub.
git push -u origin main
```
