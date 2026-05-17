# Flight Data Recorder PWA v4

PWA offline em HTML, CSS e JavaScript para registar sectores de voo com GPS, flight time, block time e consumo de combustível.

## Novidades nesta versão

- Adicionado **Flight time**.
- Adicionado **Saved sectors**.
- Adicionado **Next Sector** no auto-stop final.
- O auto-stop pergunta:
  - **OK**: guardar o sector e iniciar o próximo sector.
  - **Cancel**: guardar o sector e parar em `blocks on`.
- A app tenta identificar `departure` e `destination` por coordenadas quando há internet.
- Se não conseguir identificar aeroportos/códigos, pergunta o nome do sector manualmente.
- Exporta todos os sectores para CSV e JSON.

## Estados usados

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

## Valores default

| Setting | Value |
|---|---:|
| Taxi speed threshold | 20 kt |
| Takeoff speed min | 35 kt |
| Initial climb speed min | 90 kt |
| Climb VS min | 400 ft/min |
| Descent VS min | 300 ft/min |
| Stable time | 60 seconds |
| Cruise VS band | 250 ft/min |
| Approach trigger speed | 130 kt |
| Landing speed threshold | 85 kt |
| Auto-stop speed threshold | 3 kt |
| Auto-stop stable time | 30 seconds |
| Minimum GPS interval | 2 seconds |
| Fuel until TOC | 720 lb/h |
| Fuel cruise | 600 lb/h |
| Fuel descent/approach | 580 lb/h |

## Como correr localmente

A Geolocation API exige HTTPS ou localhost.

```bash
# Entra na pasta do projecto.
cd flight-data-recorder-pwa-v4-next-sector

# Inicia um servidor local simples.
python3 -m http.server 8080
```

Abre:

```text
http://localhost:8080
```

## Como publicar no GitHub Pages

```bash
# Inicia o repositório.
git init

# Adiciona todos os ficheiros.
git add .

# Cria o primeiro commit.
git commit -m "Add flight data recorder PWA v4"

# Define a branch principal.
git branch -M main

# Liga ao repositório remoto.
git remote add origin https://github.com/TEU-USER/flight-data-recorder-pwa.git

# Envia para o GitHub.
git push -u origin main
```

Depois activa GitHub Pages em **Settings > Pages**.

## Limitações

- Em iPhone, uma PWA não é fiável com o ecrã bloqueado.
- Mantém a app aberta e o ecrã ligado.
- GPS pode funcionar offline; identificação automática de aeroporto não.
- `speed`, `altitude` e `heading` podem vir como `null` dependendo do dispositivo/browser.
- Isto é um protótipo técnico, não um instrumento certificado.
