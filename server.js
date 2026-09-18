const express = require("express");

const app = express();
const PORT = 3000;

app.use(express.json());

app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        server: "my-pc"
    });
});

app.get("/api/products", (req, res) => {
    res.json([
        {
            id: 1,
            name: "Product A",
            price: 10000
        },
        {
            id: 2,
            name: "Product B",
            price: 20000
        },
        {
            id: 3,
            name: "Product C",
            price: 30000
        }
    ]);
});

app.post("/api/products", (req, res) => {
    const product = req.body;

    res.status(201).json({
        message: "Product created",
        product: product
    });
});

app.listen(PORT, () => {
    console.log(`API server running at http://localhost:${PORT}`);
});