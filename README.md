# Huislinks

Persoonlijke tool voor inventaris en winkellinks. Draait op Cloudflare Pages, gegevens staan in Cloudflare KV.

- `public/` is de website (`index.html` en Vue)
- `functions/api/data.js` bewaart en leest de lijst

## Instellen
1. Zet deze bestanden in een GitHub-repository.
2. Cloudflare › Workers & Pages › Create › Pages › Connect to Git. Kies de repository. Build command leeg laten, output directory: `public`.
3. Cloudflare › Storage & Databases › KV › Create namespace (bijvoorbeeld `huislinks`).
4. In het Pages-project: Settings › Bindings › Add › KV namespace. Variable name `STORE`, kies de namespace. Zet dit voor Production en Preview. Deploy daarna opnieuw.
5. In het Pages-project: Settings › General › Access policy › Enable. Laat alleen je eigen e-mailadres toe.

## Prijs automatisch lezen
`functions/api/price.js` haalt een productpagina op en leest de prijs uit de gegevens die winkels voor Google op hun pagina zetten. Er is geen extra instelling voor nodig. Winkels die bots blokkeren of de prijs pas met JavaScript tonen, geven geen prijs. Dan vul je hem zelf in.
