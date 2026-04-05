import { createBrowserRouter } from "react-router";
import { Login } from "./components/Login";
import { Dashboard } from "./components/Dashboard";
import { DeclinedRequest } from "./components/DeclinedRequest";
import { AcceptedRequest } from "./components/AcceptedRequest";
import { CaroolCheck } from "./components/CaroolCheck";
import { OpenRequests } from "./components/OpenRequests";
import { RequestDetail } from "./components/RequestDetail";
import { RequestHistory } from "./components/RequestHistory";
import { HistoryDetail } from "./components/HistoryDetail";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Login,
  },
  {
    path: "/dashboard",
    Component: Dashboard,
  },
  {
    path: "/request/declined",
    Component: DeclinedRequest,
  },
  {
    path: "/request/accepted",
    Component: AcceptedRequest,
  },
  {
    path: "/carool-check",
    Component: CaroolCheck,
  },
  {
    path: "/open-requests",
    Component: OpenRequests,
  },
  {
    path: "/request/detail/:id",
    Component: RequestDetail,
  },
  {
    path: "/history",
    Component: RequestHistory,
  },
  {
    path: "/history/detail/:id",
    Component: HistoryDetail,
  },
]);