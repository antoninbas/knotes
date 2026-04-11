/* @refresh reload */
import { render } from "solid-js/web";
import "./styles/global.css";
import App from "./App.tsx";

const root = document.getElementById("app");
if (!root) throw new Error("No #app element found");

render(() => <App />, root);
