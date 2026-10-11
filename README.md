# Metal Karar Destek

Metal üretiminde makine ölçümleri, bakım işleri, üretim partileri ve kalite kayıtlarını bir arada gösteren **yerel, tek kullanıcılı demo** uygulaması. Vue 3 + Vite arayüzü, Express API ve PostgreSQL kullanır. Sensör bağlantısı, harici veri seti veya eğitilmiş yapay zekâ modeli gerekmez. Uyarılar ve olası nedenler açıklanabilir örnek kurallardır; kesin arıza teşhisi, üretici limiti veya doğrulanmış tahmin değildir. Kimlik doğrulaması bulunmadığı için uygulamayı doğrudan internete açmayın.

## Mimari ve veri modeli

Tarayıcı `/api` isteklerini aynı adrese gönderir. Vite geliştirme ve önizleme sunucusu bu yolu Express'e iletir; Docker kurulumunda build çıktısını sunan Nginx aynı yolu `api` servisine iletir. Express parametreli SQL ile PostgreSQL'e bağlanır. Sürümlü migration dosyaları tek tek transaction içinde uygulanır ve `schema_migrations` tablosunda izlenir. `npm run migrate` tekrar çalıştırılabilir.

- `machines`: kodu normalize edilmiş makine ve arşiv durumu; `machine_status_history`: durum geçişleri.
- `machine_measurements`: zaman damgalı manuel veya sentetik ölçüm; `machine_thresholds`: makineye özel, birimli uyarı ve kritik eşikler.
- `maintenance_records`: planlanan veya tamamlanan iş; `alerts`: açık, inceleniyor ve çözüldü durumları ile çözüm gerekçesi.
- `products`, `production_batches`, `quality_records`: ürün, üretim adedi ve partiye bağlı kusur türleri.
- `batch_threshold_snapshots`: parti kaydedilirken geçerli makine eşiklerinin kopyası; tamamlanan partinin analizinde bu değerler kullanılır.

İlişkili geçmişi olan makineler fiziksel olarak silinmez; arşivlenir. Arşivli makineye yeni ölçüm, üretim ve bakım kaydı eklenmez. Tüm ID'ler PostgreSQL `BIGINT` olduğu için API'de metin olarak taşınır. İstek gövdesindeki ID alanları ve ID dizileri de JSON metni olmalıdır; sayısal ID reddedilir.

## Gereksinimler

- Docker Compose **veya** Node.js **22.12+** ve PostgreSQL **16+**.
- Frontend kilit dosyasındaki Vite 8, Node.js `^20.19.0 || >=22.12.0` ister. Proje ve container için Node 22 seçilmiştir.

## Docker ile başlatma

PowerShell:

```powershell
Copy-Item .env.example .env
# .env içindeki POSTGRES_PASSWORD değerini yerel kullanım için değiştirin.
docker compose up --build -d
docker compose ps
```

Linux/macOS:

```bash
cp .env.example .env
# .env içindeki POSTGRES_PASSWORD değerini yerel kullanım için değiştirin.
docker compose up --build -d
docker compose ps
```

Arayüz: `http://127.0.0.1:8080` (veya `FRONTEND_PORT`). API: `http://127.0.0.1:3001` (veya `API_PORT`). Portlar yalnızca bilgisayarın yerel arayüzüne bağlanır. PostgreSQL dışarıya port açmaz; `postgres_data` adlı kalıcı volume kullanır. `db` sağlıklı olunca `api` migration çalıştırır ve başlar; `api` veritabanı readiness denetimini geçince frontend başlar. `docker compose down` volume'u silmez.

Sentetik demo verileri **otomatik yüklenmez**. İsterseniz bir kez çalıştırın; sonraki çalıştırmalar yeni veri eklemez ve mevcut kullanıcı verilerini silmez:

```powershell
docker compose exec api npm run seed
```

```bash
docker compose exec api npm run seed
```

Servis günlükleri: `docker compose logs -f api`. Migration'ı ayrıca çalıştırmak için `docker compose exec api npm run migrate` kullanın.

Seed, `DEMO-NORMAL`, `DEMO-RISK`, `DEMO-STALE` ve `DEMO-MAINT` kodlu dört makine oluşturur. Eşik aşımı, gecikmiş bakım, artan parti hata oranı, eski/eksik veri ve tamamlanmış bakım ile çözülmüş uyarı örnekleri içerir. İşlem tek transaction içinde yürür; `demo_seed_runs` işareti tekrar eklemeyi önler. Aynı demo kodları kullanıcı kayıtlarında zaten varsa hiçbir kaydı değiştirmeden hata verir.

## Docker olmadan yerel çalışma

PostgreSQL'de boş bir `metal_karar_destek` veritabanı oluşturun. Bağlantı kullanıcısına bu veritabanında tablo/indeks oluşturma yetkisi verin. Bağlantı bilgilerini backend `.env` dosyasına yazın. Aynı PostgreSQL sunucusunda ayrı bir `metal_karar_test` veritabanı, integration testleri için kullanılabilir.

PowerShell, iki ayrı terminal:

```powershell
cd services/production-service
Copy-Item .env.example .env
# .env içindeki PG* bağlantı ayarlarını düzenleyin.
npm ci
npm run migrate
npm run seed   # İsteğe bağlı, sentetik demo verisi
npm run dev
```

```powershell
cd frontend
Copy-Item .env.example .env.local
npm ci
npm run dev
```

Linux/macOS, iki ayrı terminal:

```bash
cd services/production-service
cp .env.example .env
# .env içindeki PG* bağlantı ayarlarını düzenleyin.
npm ci
npm run migrate
npm run seed   # İsteğe bağlı, sentetik demo verisi
npm run dev
```

```bash
cd frontend
cp .env.example .env.local
npm ci
npm run dev
```

Vite'ın gösterdiği yerel adresi açın. Backend'i izleme olmadan çalıştırmak için `npm start` kullanın. Frontend build çıktısını yerel olarak denemek için `npm run build` ardından `npm run preview` çalıştırın; Vite'ın preview proxy'si `/api` isteklerini `VITE_API_PROXY_TARGET` adresine iletir. Docker'da build edilmiş frontend için eşdeğer proxy `frontend/nginx.conf` dosyasındadır.

## Ortam değişkenleri

| Yer | Değişken | Anlamı |
| --- | --- | --- |
| Kök `.env` | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Docker PostgreSQL veritabanı ve kimlik bilgileri. |
| Kök `.env` | `API_PORT`, `FRONTEND_PORT` | Yerel yayın portları; varsayılan 3001 ve 8080. |
| Backend `.env` | `HOST`, `PORT` | HTTP dinleme adresi ve portu; yerelde `127.0.0.1:3001`. |
| Backend `.env` | `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` | PostgreSQL bağlantısı. |
| Backend `.env` | `DATABASE_URL` | Ayrı PG* değerlerine alternatif bağlantı URI'si. |
| Test ortamı | `TEST_DATABASE_URL` | **Ayrı** test veritabanı URI'si; API integration testleri bunu kullanır. Docker test servisi eşdeğer `TEST_PG*` değerleriyle URL'yi güvenli oluşturur. |
| Frontend `.env.local` | `VITE_API_PROXY_TARGET` | Geliştirme/preview proxy hedefi; varsayılan `http://127.0.0.1:3001`. |

`frontend` tarayıcı istekleri varsayılan olarak göreli `/api` yolunu kullanır. `VITE_API_PROXY_TARGET` tarayıcı koduna gömülen bir sır değildir; yalnızca Vite sunucusunun hedefidir. `.env` dosyaları Git'e ve teslim ZIP'ine dahil edilmez.

## Test ve build

Backend birim testleri:

```powershell
cd services/production-service
npm run test:unit
```

Integration testleri yalnızca ayrı veritabanında çalışır. Komut migrations'ı test DB'ye uygular; gerçek veritabanı URI'si burada kullanılmamalıdır.

PowerShell:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://metal_demo:LOCAL_PASSWORD@127.0.0.1:5432/metal_karar_test'
npm run test:integration
Remove-Item Env:TEST_DATABASE_URL
```

Linux/macOS:

```bash
TEST_DATABASE_URL='postgresql://metal_demo:LOCAL_PASSWORD@127.0.0.1:5432/metal_karar_test' npm run test:integration
```

`npm test` bütün Node testlerini çalıştırır; `TEST_DATABASE_URL` veya Docker test servisinin `TEST_PG*` ayarları verilmemişse veritabanı gerektiren testler atlanır. Docker'da ayrı `db-test` servisiyle tüm testleri çalıştırmak için kök dizinde `docker compose --profile test run --build --rm test` kullanın. Test veritabanı ana `postgres_data` volume'unu paylaşmaz. Regresyon testleri eşik/uyarı eşitlemesini, kalite kayıt düzeltmelerini, tam 5 yüzde puan sınırını, yerel gün filtrelerini ve geçersiz tarih/ID reddini kapsar.

Frontend build:

```powershell
cd frontend
npm ci
npm run build
```

## API özeti

Tüm yollar `/api` ile başlar. Koleksiyon yanıtları `{ "items": [...], "pagination": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 } }` biçimindedir. `page` ve `limit` (1–100) kullanılabilir. Üretim partisi listesinde buna ek olarak, **bütün filtreli kayıtları** kapsayan `summary` bulunur. Hata yanıtı `{ "code": "VALIDATION_ERROR", "message": "...", "details": ... }` biçimindedir; `code` örnekleri `INVALID_JSON`, `NOT_FOUND`, `CONFLICT`, `DATABASE_UNAVAILABLE` ve `INTERNAL_ERROR` değerleridir. Silme başarılı olursa gövdesiz `204` döner. Seçim kutuları API'nin sayfalarını yükleyerek ilk 100 kayıtla sınırlı kalmaz.

| Yöntem ve yol | İşlev |
| --- | --- |
| `GET /api/health`, `GET /api/ready` | HTTP canlılığı ve veritabanı erişimi. |
| `GET /api/dashboard?from=2026-10-01&to=2026-10-10&utcOffsetMinutes=180` | Seçilen yerel günlere göre dönem özeti ve günlük trendler. |
| `GET /api/machines?search=CNC&status=running&page=1&limit=20` | Sayfalı makine listesi; arşivliler için `includeArchived=true`. |
| `POST /api/machines`, `GET /api/machines/:id`, `PATCH /api/machines/:id`, `DELETE /api/machines/:id` | Makine oluştur, ayrıntı, kısmi güncelle, arşivle. |
| `GET /api/machines/:id/risk` | Son ölçümlere göre ayrı makine riski. |
| `GET/POST /api/machines/:id/measurements` | Ölçüm geçmişi ve manuel ölçüm ekleme. |
| `GET /api/machines/:id/thresholds`, `PUT /api/machines/:id/thresholds/:kind` | Makineye özel eşikler. |
| `GET /api/machines/:id/status-history` | Durum değişiklik geçmişi. |
| `GET /api/machines/:id/maintenance`, `GET /api/machines/:id/alerts` | Makineye ait bakım ve uyarılar. |
| `GET/POST /api/products`, `GET/PATCH /api/products/:id` | Ürün listesi, oluşturma, ayrıntı ve kısmi düzeltme. |
| `GET/POST /api/batches`, `GET/PATCH /api/batches/:id` | Üretim partisi listesi, oluşturma, ayrıntı ve kısmi güncelleme; boş bitiş tarihi sonradan doldurulabilir. Liste `machineId`, `productId`, `from`, `to`, `utcOffsetMinutes` ile filtrelenir. |
| `GET/POST /api/batches/:id/quality`, `PATCH/DELETE /api/batches/:id/quality/:qualityId` | Kalite kaydı listeleme, ekleme, düzeltme ve silme. Silme `204` döner. |
| `GET /api/batches/:id/analysis`, `POST /api/batches/:id/analysis/refresh` | Olası neden analizi; `GET` yalnızca okur, `POST` ilgili kalite uyarısını da günceller. |
| `GET/POST /api/maintenance`, `GET/PATCH /api/maintenance/:id`, `POST /api/maintenance/:id/complete` | Bakım listeleme, planlama ve seçili uyarıları gerekçeyle kapatarak tamamlama. |
| `GET /api/alerts`, `PATCH /api/alerts/:id` | Açık, inceleniyor, çözüldü durumları; `status`, `kind`, `machineId` filtreleri. |

Örnek makine isteği (PowerShell):

```powershell
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3001/api/machines' `
  -ContentType 'application/json' `
  -Body '{"code":"cnc-01","name":"CNC Freze 1","status":"running"}'
```

Linux/macOS:

```bash
curl -sS -X POST 'http://127.0.0.1:3001/api/machines' \
  -H 'Content-Type: application/json' \
  -d '{"code":"cnc-01","name":"CNC Freze 1","status":"running"}'
```

Örnek yanıtın ilgili alanları: `{ "id": "123", "code": "CNC-01", "name": "CNC Freze 1", "status": "running", "archived_at": null }`. Ölçüm isteği: `POST /api/machines/123/measurements` gövdesi `{ "kind": "vibration_mm_s", "value": 5.2, "unit": "mm/s", "measured_at": "2026-10-10T09:00:00Z", "source": "manual" }`. Sunucu birimi türden belirler; yanlış birim reddedilir. Kalite kaydı örneği: `POST /api/batches/456/quality` gövdesi `{ "kind": "dimension_out_of_tolerance", "count": 3, "description": "Ölçü kontrolü" }`. Bakım tamamlama örneği: `POST /api/maintenance/789/complete` gövdesi `{ "action_taken": "Bağlama kontrol edildi", "resolved_alert_ids": ["321"], "resolution_reason": "Ölçüm yeniden kontrol edildi" }`.

Makine durumları `idle`, `running`, `maintenance`; bakım türleri `preventive`, `corrective`, `inspection`; kalite türleri `burr`, `surface_defect`, `dimension_out_of_tolerance` değerleridir. API'ye yollanan tarih/saatler ISO 8601 saat dilimi içermelidir. Geçersiz takvim günleri (ör. `2026-02-30`) reddedilir. API ID'leri metin olarak döndürür ve gövdede de metin bekler; istemci `Number` dönüşümü yapmamalıdır.

`from` ve `to` parametrelerine yalnızca tarih (`YYYY-MM-DD`) verildiğinde `utcOffsetMinutes`, UTC'ye göre **doğu yönündeki dakika farkıdır**: Türkiye saati için `180`. Örneğin `from=2026-01-02&to=2026-01-02&utcOffsetMinutes=180`, 2 Ocak yerel gününü kapsar; aynı günün önceki UTC akşamına denk gelen kayıtları da getirir. Parametre verilmezse UTC (`0`) kullanılır. Tam ISO tarih/saat gönderilirse içindeki saat dilimi uygulanır. Tarayıcı arayüzü gün filtreleriyle birlikte kendi UTC farkını gönderir.

## Karar desteği ve oranların anlamı

Başlangıç ölçüm türleri: sıcaklık (`temperature_c`, °C), titreşim (`vibration_mm_s`, mm/s), çalışma saati (`runtime_hours`, h). Demo eşikleri sırasıyla **75/90 °C**, **4,5/7,1 mm/s**, **500/1000 h** (uyarı/kritik) olarak sentetik örneklerde sunulur. **Demo amaçlıdır, üretici limitleriyle doğrulanmalıdır.** Makineye göre değiştirilebilir. Son ölçüm yoksa veya 24 saatten eskiyse durum normal kabul edilmez; eksik/eski veri gösterilir. Geçmiş tarihli yeni kayıt, daha yeni ölçümü değiştirmez.

Makinenin güncel riski en son ölçüm ile **güncel** eşiği kullanır. Eşik değişince mevcut ölçüm uyarısı yeniden değerlendirilir: risk normale dönerse açık uyarı kapanır; risk uyarı/kritik düzeye çıkarsa uyarı açılır veya güncellenir. Uyarı kanıtındaki `demo_threshold`, eşiğin kaydedilmiş `is_demo` işaretini taşır. Parti analizi ise parti oluşturulurken `batch_threshold_snapshots` tablosuna alınan eşikleri kullanır. Parti bitişi daha sonra girilse veya makine eşiği sonradan değişse de o partinin eşik kanıtı sabit kalır. **Migration öncesinde oluşturulmuş partilerin gerçek eski eşikleri geri çıkarılamaz:** migration, o sırada mevcut eşiklerle bir kerelik başlangıç kopyası oluşturur. Ayrıca parti kaydedilirken makine için tanımlanmamış bir eşik türü sonradan geçmiş partiye eklenmez.

Parti hata oranı `hatalı parça adedi / toplam üretilen parça adedi` olarak hesaplanır. Toplam üretim sıfırsa oran **tanımsızdır**, `%0` değildir. Bir parçada birden fazla kusur bulunabildiğinden `quality_records.count` değerlerinin toplamı hatalı parça sayısını aşabilir; kusur sayıları hata oranı payına eklenmez. Dönem toplamı `toplam hatalı / toplam üretim` ile ağırlıklı hesaplanır, parti yüzdelerinin düz ortalaması kullanılmaz.

Olası neden analizi mevcut parti ile **aynı makine ve ürünün, parti başlangıcından önceki 30 günde tamamlanmış en son 100 partisini** karşılaştırır. Güncel partide ve bu önceki dönem partilerinin toplamında ayrı ayrı en az **20** parça, ayrıca hata oranında en az **5 yüzde puan** artış gerekir. Önceki 30 günde 20 parça yoksa artış iddiası kurulmaz. Ölçüm kuralları yalnızca partinin başlangıç/bitiş aralığındaki ölçümleri kullanır. Yüksek titreşimle ölçü toleransı kusuru birlikte görülürse takım/bağlama kontrolü, yüksek sıcaklıkla yüzey kusuru birlikte görülürse soğutma/işlem parametresi kontrolü önerilir. Gecikmiş bakım ve artan oran bakım önceliği önerir. Bulgularda kullanılan kayıtlar, zaman aralığı ve veri sınırlılıkları gösterilir. Bunlar nedensellik veya güven yüzdesi iddiası değildir; koşullar sağlanmazsa “analiz için yeterli veri yok” sonucu gösterilir.

Ölçüm, kalite kaydı, parti adedi/tarihi veya karşılaştırmada kullanılan önceki parti değişince ilgili açık kalite uyarısının kanıtı yeniden hesaplanır. Analiz artık bulgu üretmiyorsa uyarı gerekçeyle kapanır. Bakım planı ertelenince gecikme uyarısı kapanır; yeniden gecikirse güncel tarihle yeniden değerlendirilir. Bakım planı veya tamamlanma bilgisi parti analizindeki bakım bulgusunu etkiliyorsa kalite uyarısı da yenilenir. Kullanıcının gerekçeyle kapattığı kalite uyarısı aynı bulgu değişmeden otomatik tekrar açılmaz. `GET /analysis` okuma işlemidir; arayüzdeki **Analizi yenile** düğmesi `POST /analysis/refresh` çağırarak uyarıyı da eşitler.

Arayüzde ürün detayından kod, ad ve açıklama; parti detayından başlangıç/bitiş tarihi ve adetler; aynı ekrandan kalite kaydının türü, adedi ve açıklaması düzenlenebilir. Hatalı kalite kaydı silinebilir. Bir kusur türünün toplam adedi partideki hatalı parça adedini aşamaz; hatalı adedi azaltmak için önce ilgili kalite kayıtlarını düzeltin veya silin. Bitiş tarihi boş bırakılmış parti, detayındaki **Partiyi düzenle ve tamamla** seçeneğiyle tamamlanabilir. Planlı bakımın türü, tarihi ve açıklaması bakım ekranından değiştirilebilir; tamamlanmış bakım düzenlenmez. Formların makine, ürün ve ilgili uyarı seçimleri tüm sayfalardan yüklenir.

## Kısa demo akışı

1. `npm run seed` ile sentetik senaryoları yükleyin veya uygulamada yeni makine ve ürün oluşturun.
2. Makine detayında eşikleri inceleyin, yeni sıcaklık veya titreşim ölçümü girin ve ölçüm riski/uyarıları gözleyin.
3. Aynı makine ve ürün için önceki ve güncel üretim partileri açın; toplam ve hatalı adetleri girin.
4. Güncel partiye ölçü toleransı veya yüzey kusuru kalite kaydı ekleyin. Kusur adedinin hatalı parça adedinden farklı olabileceğini karşılaştırın. Parti bitişi boşsa detay ekranından tamamlayın.
5. Parti detayındaki olası nedenleri ve kullanılan ölçüm zamanlarını inceleyin. Hatalı adedi veya kalite kaydını düzeltip **Analizi yenile** ile güncel kanıtı görün.
6. Bakım kaydı planlayın; tarihi ertelerseniz gecikme uyarısını kontrol edin. Bakımı tamamlayınca ilgili uyarıyı seçip çözüm gerekçesini kaydedin; ilgisiz uyarılar açık kalır.

## Sorun giderme

- **API veritabanına bağlanamıyor:** `.env` içindeki `PG*` değerlerini ve `docker compose ps` çıktısında `db` health durumunu kontrol edin. `GET /api/health` yalnızca HTTP canlılığını; `GET /api/ready` veritabanı erişimini doğrular.
- **Tablo yok:** Backend klasöründe `npm run migrate` veya Docker'da `docker compose exec api npm run migrate` çalıştırın. Migration mevcut veriyi silmeden yeni şemayı uygular.
- **Frontend API hatası:** Vite dev/preview için `VITE_API_PROXY_TARGET` ve API portunu karşılaştırın. Docker'da `docker compose logs api frontend` ile durumu görün.
- **Port kullanılıyor:** Kök `.env` içinde `API_PORT`/`FRONTEND_PORT` değiştirin; Docker dışı backend için `PORT` ve frontend proxy hedefini eşleştirin.
- **Test DB reddedildi:** `TEST_DATABASE_URL` ana veritabanına işaret etmemeli; adı `_test` ile biten ayrı veritabanı oluşturun.
