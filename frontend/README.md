# Metal Karar Destek ön yüzü

Vue 3 + Vite arayüzü. API çağrıları varsayılan olarak aynı origin'deki `/api` yoluna gider.

```powershell
Copy-Item .env.example .env
npm ci
npm run dev
```

Linux/macOS: `cp .env.example .env && npm ci && npm run dev`.

`VITE_API_PROXY_TARGET` geliştirme ve `npm run preview` proxy hedefini belirler; varsayılan `http://127.0.0.1:3001`'dir. `npm run build` sonucu `dist/` dizinindedir. Docker kurulumunda nginx `/api` isteklerini API hizmetine iletir. Başka bir statik sunucu kullanılacaksa aynı `/api` yönlendirmesi kurulmalıdır.

`VITE_API_BASE_URL` isteğe bağlıdır; boşken göreli `/api` kullanılır. Ayrı bir origin verilirse API'de uygun CORS ayarı gerekir. Yerel demo için önerilen kurulum aynı origin proxy'sidir.
