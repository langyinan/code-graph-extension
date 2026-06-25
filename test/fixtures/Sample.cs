using System;
using System.Collections.Generic;
using App.Services;

namespace App {
    class Sample {
        void Main() {
            Helper();
        }

        void Helper() {
            var list = new List<string>();
            Console.WriteLine(list.Count);
        }
    }
}
