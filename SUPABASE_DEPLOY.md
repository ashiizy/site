## Развёртывание общей базы в Supabase (и доступ по ссылке)

Ниже шаги “под ключ”: общая база данных + общий пароль на добавление/удаление/редактирование.

## Что в итоге должно получиться
- У вас есть проект Supabase с таблицей `public.instructions`.
- Развёрнута Edge Function `instructions` (GET доступен всем, POST/DELETE требуют пароль).
- В `assets/config.js` прописаны `SUPABASE_URL` и `SUPABASE_ANON_KEY`.
- Открываете сайт по ссылке → данные общие для всех; при первом изменении попросит пароль.

### 1) Создайте проект Supabase
- Зайдите в Supabase → Create project.
- Скопируйте значения:
  - **Project URL**
  - **anon public key**
  - **project_ref** (объяснение ниже)

Где взять `project_ref`:
- Откройте ваш проект в браузере. Адрес обычно такой: `https://supabase.com/dashboard/project/<project_ref>`
- Часть после `/project/` — это и есть `project_ref` (например `abcxyzdefghijklmno`).

### 2) Создайте таблицу
Откройте SQL Editor и выполните файл:
- `supabase/schema.sql`

### 3) Установите Node.js (один раз)
Supabase CLI ставится через `npm`, поэтому нужен Node.js.
- Скачайте LTS версию Node.js, установите.
- Перезапустите PowerShell (важно).

Проверка:

```powershell
node -v
npm -v
```

### 4) Установите Supabase CLI (один раз)
В PowerShell:

```powershell
npm i -g supabase
supabase --version
```

### 5) Логин в Supabase CLI
Откроется браузер для входа.

```powershell
supabase login
```

### 6) Откройте PowerShell в папке сайта
Самый простой способ:
- Откройте проводник → `c:\Users\Admin\Desktop\сайт`
- Shift + ПКМ по пустому месту → “Открыть окно PowerShell здесь”

Проверка, что вы в нужной папке:

```powershell
pwd
```

Должно быть: `C:\Users\Admin\Desktop\сайт`

### 7) Подключите Supabase проект к этой папке

```powershell
supabase link --project-ref <project_ref>
```

Если попросит выбрать организацию/проект — выберите ваш.

### 8) Задайте секрет (общий пароль редактирования)

```powershell
supabase secrets set EDIT_PASSWORD="<ваш_общий_пароль>"
```

### 9) Деплой Edge Function

```powershell
supabase functions deploy instructions
```

### 10) Проверка функции
Откройте в браузере:
- `https://<project_ref>.supabase.co/functions/v1/instructions`

Должен вернуться JSON с `version` и `instructions`.

### 11) Включите облако на фронтенде
Откройте файл:
- `assets/config.js`

Заполните:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Значения берутся в Supabase Dashboard:
- Project Settings → API → `Project URL` и `anon public`

### 12) Опубликуйте сайт по ссылке
Так как это статический сайт, можно выложить на любой хостинг статических файлов:
- GitHub Pages / Cloudflare Pages / Netlify / Vercel / любой внутренний web-сервер

Важно: `assets/config.js` должен быть опубликован вместе с сайтом.

---

## Частые проблемы (Windows)
### `supabase` не находится
- Закройте и заново откройте PowerShell.
- Проверьте `npm -g list --depth=0`.

### 401 / “Неверный пароль” при сохранении/удалении
- Пароль запрашивается в браузере при первой попытке изменить данные.
- Если ошиблись — просто перезагрузите страницу и введите снова (пароль хранится в sessionStorage).


