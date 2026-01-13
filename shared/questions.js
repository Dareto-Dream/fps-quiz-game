// Spanish adjective agreement grammar questions
// Each question has: question text, 4 options, correct answer index (0-3)
module.exports = [
  // Gender agreement (-o / -a)
  {
    question: "Señorita bonit?",
    options: ["bonito", "bonita", "bonitos", "bonitas"],
    correct: 1
  },
  {
    question: "El chico alt?",
    options: ["alta", "alto", "altos", "altas"],
    correct: 1
  },
  {
    question: "La chica alt?",
    options: ["alto", "alta", "altos", "altas"],
    correct: 1
  },

  // Plural agreement
  {
    question: "Los chicos inteligent?",
    options: ["inteligente", "inteligentas", "inteligentes", "inteligentos"],
    correct: 2
  },
  {
    question: "Las chicas inteligent?",
    options: ["inteligente", "inteligentas", "inteligentes", "inteligentos"],
    correct: 2
  },

  // -e adjectives (same gender)
  {
    question: "El examen difíc?",
    options: ["difícil", "difícila", "difíciles", "difícils"],
    correct: 0
  },
  {
    question: "Los exámenes difíc?",
    options: ["difícil", "difícila", "difíciles", "difícils"],
    correct: 2
  },
  {
    question: "La clase difíc?",
    options: ["difícil", "difícila", "difíciles", "difícils"],
    correct: 0
  },

  // -or adjectives
  {
    question: "El hombre trabajad?",
    options: ["trabajador", "trabajadora", "trabajadores", "trabajadoras"],
    correct: 0
  },
  {
    question: "La mujer trabajad?",
    options: ["trabajador", "trabajadora", "trabajadores", "trabajadoras"],
    correct: 1
  },
  {
    question: "Las mujeres trabajad?",
    options: ["trabajador", "trabajadora", "trabajadores", "trabajadoras"],
    correct: 3
  },

  // Mixed gender plural
  {
    question: "Manuel y Lola son alt?",
    options: ["alto", "alta", "altos", "altas"],
    correct: 2
  },

  // Color adjectives
  {
    question: "La chica rubi?",
    options: ["rubio", "rubia", "rubios", "rubias"],
    correct: 1
  },
  {
    question: "Los chicos rubi?",
    options: ["rubio", "rubia", "rubios", "rubias"],
    correct: 2
  },

  // Shortened forms (apócope)
  {
    question: "Joaquín es un bu?n amigo",
    options: ["bueno", "buen", "bon", "bien"],
    correct: 1
  },
  {
    question: "Hoy es un m?l día",
    options: ["malo", "mal", "mala", "malos"],
    correct: 1
  },
  {
    question: "Alejandro es un gr?n hombre",
    options: ["grande", "gran", "granda", "grandes"],
    correct: 1
  },

  // Nationality adjectives
  {
    question: "La mujer español?",
    options: ["español", "española", "españoles", "españolas"],
    correct: 1
  },
  {
    question: "Las mujeres argentin?",
    options: ["argentino", "argentina", "argentinos", "argentinas"],
    correct: 3
  }
];
