import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import App from "./App.jsx";
import { store } from "./app/store";
import "./index.css";

const preventAppZoom = () => {
  const blockZoomKeys = (event) => {
    const key = String(event.key || "").toLowerCase();
    if (
      (event.ctrlKey || event.metaKey) &&
      ["+", "=", "-", "_", "0"].includes(key)
    ) {
      event.preventDefault();
    }
  };

  const blockCtrlWheel = (event) => {
    if (event.ctrlKey || event.metaKey) event.preventDefault();
  };

  const blockGesture = (event) => event.preventDefault();

  window.addEventListener("keydown", blockZoomKeys, { passive: false });
  window.addEventListener("wheel", blockCtrlWheel, { passive: false });
  window.addEventListener("gesturestart", blockGesture, { passive: false });
  window.addEventListener("gesturechange", blockGesture, { passive: false });
  window.addEventListener("gestureend", blockGesture, { passive: false });
};

preventAppZoom();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>,
);
