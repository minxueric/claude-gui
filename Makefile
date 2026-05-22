.PHONY: dev backend frontend build run install reindex clean

install:
	cd backend && pip install -e .
	cd frontend && npm install

backend:
	cd backend && uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload

frontend:
	cd frontend && npm run dev

dev:
	@echo ""
	@echo "  Claude GUI — dev mode"
	@echo "  Open: http://localhost:5173"
	@echo ""
	@$(MAKE) -j2 backend frontend

build:
	cd frontend && npm run build

run: build
	@echo ""
	@echo "  Claude GUI — production mode"
	@echo "  Open: http://localhost:8765"
	@echo ""
	cd backend && uvicorn app.main:app --host 127.0.0.1 --port 8765

reindex:
	curl -s -X POST http://127.0.0.1:8765/api/admin/reindex | python -m json.tool

clean:
	rm -rf frontend/dist frontend/node_modules backend/*.egg-info ~/.claude_gui/index.db*
