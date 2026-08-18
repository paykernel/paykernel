import { createCheckoutFetchApp } from "./handlers";
import { runCheckoutHttpScenarios } from "./scenarios";

runCheckoutHttpScenarios("checkout-kernel", (kernel) => createCheckoutFetchApp(kernel));
