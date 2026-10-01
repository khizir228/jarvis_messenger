# Jarvis Messenger 5.0 — ONLINE

Готовая версия для публичного запуска через GitHub + Render. Дизайн и WebSocket-чат сохранены.

## Архитектура

- Frontend: HTML/CSS/JS внутри FastAPI
- Backend: FastAPI + Uvicorn
- Realtime: WebSocket `/ws/{room_id}`
- Database: PostgreSQL через `DATABASE_URL`
- Локальный запуск без `DATABASE_URL`: SQLite автоматически
- Публичный WebSocket: браузер автоматически использует `wss://` на HTTPS

## Важно для realtime

`render.yaml` запускает **один Uvicorn-процесс**, чтобы in-memory `ConnectionManager` видел все WebSocket-подключения внутри одного инстанса. Не ставь несколько workers для этой версии, пока мы не вынесем realtime-менеджер в Redis/pubsub.

## GitHub + Render + PostgreSQL

1. Создай GitHub repository и загрузи содержимое этой папки.
2. На Render: New → Web Service → подключи repository.
3. Render увидит `render.yaml`; Build/Start уже прописаны.
4. Для бесплатной базы можно создать проект PostgreSQL в Supabase и взять его connection string. В Render добавь Environment Variable `DATABASE_URL` с этой строкой.
5. `JWT_SECRET` Render сгенерирует автоматически по `render.yaml`.
6. Дождись deploy. Открой выданный `https://....onrender.com`.
7. Проверь `https://....onrender.com/api/health`: должен вернуться JSON с `ok: true` и `database: postgres`.

## Проверка WebSocket

Открой сайт в двух браузерах/устройствах, войди двумя аккаунтами, добавь второго пользователя в комнату по invite-коду и отправь сообщение. Сообщение должно появиться без обновления страницы. В DevTools → Network → WS соединение должно идти на `wss://.../ws/...`.

## Что бесплатно

Render Free Web Service подходит для теста/личного проекта, но после 15 минут без входящего HTTP/WebSocket-трафика он засыпает; первое подключение после этого может занять около минуты. Для realtime это нормально: активное WebSocket-соединение с входящими сообщениями удерживает сервис от idle spin-down.

Для базы я рекомендую Supabase Free: сейчас это PostgreSQL с лимитом 500 MB на проект. Free-проект может автоматически приостанавливаться после недели бездействия, поэтому для постоянно используемого мессенджера это нужно учитывать.

## Локально

```bat
START_JARVIS.bat
```

Без `DATABASE_URL` локально используется `app/messenger.db`, поэтому текущий LAN-режим продолжает работать.
