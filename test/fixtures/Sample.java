package com.example;

import java.util.List;
import com.example.service.AuthService;

public class Sample {
    public void main() {
        helper();
    }

    private void helper() {
        List<String> items = AuthService.list();
    }
}
